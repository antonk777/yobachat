import tmi from 'tmi.js';
import { EventEmitter } from 'node:events';
import chalk from 'chalk';

import type { ChatMessage, Platform, TwitchServiceConfig } from '@shared/shared-types.js';
import type { PlatformService, PlatformWithConfig, PlatformServiceEvents } from '@/types.js';

import {
  kTwitchBadgeMapping,
  kSubGifterBadgeMapping,
  kBitsBadgeMapping
} from '@/constants/twitch.js';
import { randomUUID } from 'node:crypto';


// Twitch emote types
type TwitchEmotes = { [emoteid: string]: string[]; };

// Retry configuration
const kRetryConfig = {
  maxRetries: Infinity, // Retry indefinitely
  initialDelay: 1000, // 1 second
  maxDelay: 60000, // 60 seconds
  backoffMultiplier: 2, // Double delay on each retry
} as const;

/**
 * Service for watching Twitch chat messages
 */
export class TwitchService extends EventEmitter<PlatformServiceEvents> implements PlatformService {
  public readonly platform: Platform;
  private active: boolean = false;
  private logPrefix: string;

  private client: tmi.Client | null = null;
  private readonly config: TwitchServiceConfig;
  private retryCount: number = 0;
  private retryTimeout: NodeJS.Timeout | null = null;
  private isStopping: boolean = false;
  private shouldReconnect: boolean = false;

  constructor(platformConfig: PlatformWithConfig<TwitchServiceConfig>) {
    super();

    this.platform = {
      id: platformConfig.id,
      name: platformConfig.name,
      color: platformConfig.color,
      abbr: platformConfig.abbr
    };

    this.config = platformConfig.config as TwitchServiceConfig;

    this.logPrefix = chalk.hex(this.platform.color)(`[${this.platform.abbr}]`);
  }

  isActive(): boolean {
    return this.active;
  }

  async start(): Promise<void> {
    if (this.active) {
      return;
    }

    this.isStopping = false;
    this.shouldReconnect = true;
    this.retryCount = 0;

    await this.attemptConnection();
  }

  /**
   * Attempt to connect with retry logic
   */
  private async attemptConnection(): Promise<void> {
    if (this.isStopping || !this.shouldReconnect) {
      return;
    }

    // Clean up existing client if any
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (error) {
        // Ignore disconnect errors
      }
      this.client = null;
    }

    this.client = new tmi.Client({
      channels: [this.config.channelId],
    });

    this.setupEventHandlers();

    try {
      await this.client.connect();
      // Connection successful - reset retry count
      this.retryCount = 0;
    } catch (error) {
      console.error(`${this.logPrefix} Error connecting to ${this.config.channelId}:`, error);
      this.setActive(false);
      this.scheduleRetry();
    }
  }

  private handleMessage(channel: string, message: string, tags: tmi.ChatUserstate): void {
    // console.log(`${this.logPrefix} Message:`, message, tags);

    if (!tags.id) {
      console.warn(`${this.logPrefix} Message ID is required:`, tags);
      return;
    }

    const emotesMap = this.parseEmotes(tags.emotes, message);

    const badgeImages = this.parseBadgeImages(tags.badges);

    const messageId = `twitch-${tags.id}`;

    const replyToId = tags['reply-parent-msg-id']
      ? `twitch-${tags['reply-parent-msg-id']}`
      : undefined;

    if (
      replyToId &&
      tags['reply-parent-display-name'] &&
      message.includes(`@${tags['reply-parent-display-name']}`)
    ) {
      message = message.replace(`@${tags['reply-parent-display-name']}`, '').trim();
    }

    const chatMessage: ChatMessage = {
      id: messageId,
      platform: this.platform,
      channel: channel.replace('#', ''),
      username: tags['display-name'] || tags.username || '',
      message: message,
      timestamp: tags['tmi-sent-ts'] ? parseInt(tags['tmi-sent-ts']) : Date.now(),
      avatar: tags['user-profile-image-url'],
      badges: tags.badges ? Object.keys(tags.badges) : [],
      badgeImages: Object.keys(badgeImages).length > 0 ? badgeImages : undefined,
      color: tags.color || undefined,
      isSubscriber: tags.subscriber === true,
      isModerator: tags.mod === true,
      isVip: tags.vip === true,
      emotesMap: Object.keys(emotesMap).length > 0 ? emotesMap : undefined,
      replyToId
    };

    this.emit('messageUpdated', chatMessage);
  }

  /**
   * Setup event handlers for the Twitch client
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on('message', (
      channel: string,
      tags: tmi.ChatUserstate,
      message: string
    ) => {
      this.handleMessage(channel, message, tags);
    });

    this.client.on('connected', () => {
      console.log(`${this.logPrefix} Connected to ${this.config.channelId}`);
      this.setActive(true);
      this.retryCount = 0; // Reset retry count on successful connection
    });

    this.client.on('disconnected', (reason: string) => {
      console.log(`${this.logPrefix} Disconnected from ${this.config.channelId}${reason ? `: ${reason}` : ''}`);
      this.setActive(false);

      // Only attempt reconnection if we're not stopping and should reconnect
      if (!this.isStopping && this.shouldReconnect) {
        console.log(`${this.logPrefix} Scheduling reconnection...`);
        this.scheduleRetry();
      }
    });

    this.client.on('reconnect', () => {
      console.log(`${this.logPrefix} Reconnecting to ${this.config.channelId}...`);
    });
  }

  /**
   * Schedule a retry with exponential backoff
   */
  private scheduleRetry(): void {
    if (this.isStopping || !this.shouldReconnect) {
      return;
    }

    // Clear any existing retry timeout
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    // Check if we've exceeded max retries
    if (this.retryCount >= kRetryConfig.maxRetries) {
      console.error(`${this.logPrefix} Max retries (${kRetryConfig.maxRetries}) exceeded. Stopping reconnection attempts.`);
      return;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      kRetryConfig.initialDelay * Math.pow(kRetryConfig.backoffMultiplier, this.retryCount),
      kRetryConfig.maxDelay
    );

    this.retryCount++;
    console.log(`${this.logPrefix} Retrying connection in ${delay}ms (attempt ${this.retryCount})...`);

    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      this.attemptConnection();
    }, delay);
  }

  async stop(): Promise<void> {
    this.isStopping = true;
    this.shouldReconnect = false;

    // Clear any pending retry
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    if (!this.client) {
      return;
    }

    try {
      await this.client.disconnect();
      this.client = null;
      this.setActive(false);
      this.retryCount = 0;
      console.log(`${this.logPrefix} Stopped watching ${this.config.channelId}`);
    } catch (error) {
      console.error(`${this.logPrefix} Error disconnecting from ${this.config.channelId}:`, error);
      // Still mark as stopped even if disconnect fails
      this.client = null;
      this.setActive(false);
    }
  }

  private setActive(active: boolean): void {
    if (this.active !== active) {
      this.active = active;
      this.emit('status', active);
    }
  }

  /**
   * Get badge ID based on name and version for URL construction
   */
  private getBadgeId(badgeName: string, badgeVersion: string): string {
    // Handle badges that have different UUIDs based on version
    if (badgeName === 'sub-gifter') {
      return kSubGifterBadgeMapping[badgeVersion] || kSubGifterBadgeMapping['1'];
    }

    if (badgeName === 'bits') {
      return kBitsBadgeMapping[badgeVersion] || kBitsBadgeMapping['1'];
    }

    // Use standard badge mapping
    return kTwitchBadgeMapping[badgeName] || badgeName; // fallback to name if not found
  }

  /**
   * Parse Twitch badges and create a mapping of badge names to image URLs
   */
  private parseBadgeImages(badges: tmi.Badges | undefined): Record<string, string> {
    const badgeImages: Record<string, string> = {};

    if (!badges) {
      return badgeImages;
    }

    for (const [badgeName, badgeVersion] of Object.entries(badges)) {
      if (badgeVersion !== undefined) {
        const badgeId = this.getBadgeId(badgeName, badgeVersion);
        const badgeUrl = `https://static-cdn.jtvnw.net/badges/v1/${badgeId}/2`;
        badgeImages[badgeName] = badgeUrl;
      }
    }

    return badgeImages;
  }

  /**
   * Parse Twitch emotes and create a mapping of emote text to image URLs
   */
  private parseEmotes(emotes: TwitchEmotes | undefined, message: string): Record<string, string> {
    const emotesMap: Record<string, string> = {};

    if (!emotes) {
      return emotesMap;
    }

    // Twitch emotes format: { "25": ["0-4", "6-10"], "354": ["12-19"] }
    // Where keys are emote IDs and values are arrays of position ranges
    for (const [emoteId, positions] of Object.entries(emotes)) {
      if (!positions || positions.length === 0) continue;

      // Use the first position range to extract the emote text
      const firstRange = positions[0];
      const [start, end] = firstRange.split('-').map(Number);

      if (start !== undefined && end !== undefined && start >= 0 && end < message.length) {
        const emoteText = message.substring(start, end + 1);
        const emoteUrl = `https://static-cdn.jtvnw.net/emoticons/v2/${emoteId}/default/dark/2.0`;

        emotesMap[emoteText] = emoteUrl;
      }
    }

    return emotesMap;
  }
}

