import { EventEmitter } from 'node:events';
import chalk from 'chalk';

import type { ChatMessage, Platform, YouTubeServiceConfig } from '@shared/shared-types.js';
import type {
  PlatformService,
  PlatformWithConfig,
  YouTubeSearchResponse,
  YouTubeVideoResponse,
  YouTubeLiveChatResponse,
  PlatformServiceEvents,
} from '@/types.js';
import { kYouTubeEmoteMapping } from '@/constants/youtube.js';


/**
 * Service for watching YouTube live chat messages
 */
export class YouTubeService extends EventEmitter<PlatformServiceEvents> implements PlatformService {
  public readonly platform: Platform;
  private active: boolean = false;
  private readonly config: YouTubeServiceConfig;
  private logPrefix: string;

  private pollInterval: NodeJS.Timeout | null = null;
  private retryInterval: NodeJS.Timeout | null = null;
  private liveChatId: string | null = null;
  private nextPageToken: string | null = null;
  private isInitialized: boolean = false;
  private serviceStartTime: number | null = null;

  constructor(platformConfig: PlatformWithConfig<YouTubeServiceConfig>) {
    super();

    this.platform = {
      id: platformConfig.id,
      name: platformConfig.name,
      color: platformConfig.color,
      abbr: platformConfig.abbr
    };

    this.config = platformConfig.config;

    this.logPrefix = chalk.hex(this.platform.color)(`[${this.platform.abbr}]`);
  }

  isActive(): boolean {
    return this.active;
  }

  private setActive(active: boolean): void {
    if (this.active !== active) {
      this.active = active;
      this.emit('status', active);
    }
  }

  getConsoleBadge() {
    const platformColor = chalk.hex(this.platform.color);

    return platformColor(`[${this.platform.abbr}]`);
  }

  /**
   * Parse YouTube emotes/emojis from message text and create a mapping to image URLs
   * YouTube uses Unicode emojis and custom emotes in :emotename: format
   */
  private parseEmotes(messageText: string): Record<string, string> {
    const emotesMap: Record<string, string> = {};

    // Regular expression to match custom YouTube emotes in :emotename: format
    // Matches : followed by alphanumeric characters, hyphens, underscores, and : again
    const customEmoteRegex = /:([a-zA-Z0-9_-]+):/g;

    // Find all custom emotes in the message
    const customEmoteMatches = messageText.matchAll(customEmoteRegex);

    for (const match of customEmoteMatches) {
      const [fullEmote, emoteName] = match;

      if (emoteName && !emotesMap[fullEmote]) {
        // Look up emote URL from mapping (mapping now contains full URLs)
        const emoteUrl = kYouTubeEmoteMapping[emoteName.toLowerCase()];

        if (emoteUrl) {
          // Use the full URL directly from the mapping
          emotesMap[fullEmote] = emoteUrl;
        }
      }
    }

    return emotesMap;
  }

  async start(): Promise<void> {
    if (this.active) {
      return;
    }

    if (!this.config.apiKey) {
      throw new Error('YouTube API key is required');
    }

    console.log(`${this.getConsoleBadge()} Started watching ${this.config.channelId} - will retry until a live stream is found`);

    // Start retrying to find a live stream
    this.startRetryingForLiveStream();
  }

  /**
   * Start retrying to find a live stream periodically
   */
  private startRetryingForLiveStream(): void {
    // Try immediately first
    this.tryInitializeLiveChat();

    // Then retry every 30 seconds until a stream is found
    this.retryInterval = setInterval(() => {
      if (!this.isInitialized) {
        this.tryInitializeLiveChat();
      }
    }, 15000); // Check every 15 seconds
  }

  /**
   * Try to initialize the live chat, but don't throw errors
   */
  private async tryInitializeLiveChat(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // First, get the active live broadcast
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${this.config.channelId}&type=video&eventType=live&key=${this.config.apiKey}`;
      const searchResponse = await fetch(searchUrl);
      const searchData = (await searchResponse.json()) as YouTubeSearchResponse;

      if (!searchData.items || searchData.items.length === 0) {
        // No live stream yet, will retry
        return;
      }

      const videoId = searchData.items[0].id?.videoId;
      if (!videoId) {
        return;
      }

      // Get the live chat ID
      const videoUrl = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${this.config.apiKey}`;
      const videoResponse = await fetch(videoUrl);
      const videoData = (await videoResponse.json()) as YouTubeVideoResponse;

      if (!videoData.items || !videoData.items[0].liveStreamingDetails?.activeLiveChatId) {
        // No live chat yet, will retry
        return;
      }

      this.liveChatId = videoData.items[0].liveStreamingDetails.activeLiveChatId;
      this.isInitialized = true;
      this.serviceStartTime = Date.now();

      // Stop retrying and start polling for messages
      if (this.retryInterval) {
        clearInterval(this.retryInterval);
        this.retryInterval = null;
      }

      // Start polling for messages
      this.pollInterval = setInterval(() => {
        this.pollMessages()
      }, this.config.pollInterval);

      console.log(`${this.getConsoleBadge()} Live stream found! Started watching chat for ${this.config.channelId}`);
    } catch (error) {
      this.setActive(false);
      // Silently fail and retry later
      // Only log if it's not a "no stream" type error
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('No active live stream') && !errorMessage.includes('No active live chat')) {
        console.error(`${this.getConsoleBadge()} Error checking for live stream:`, error);
      }
    }
  }

  /**
   * Reset the service and start retrying for a new live stream
   */
  private resetAndRetry(): void {
    this.isInitialized = false;
    this.liveChatId = null;
    this.nextPageToken = null;
    this.serviceStartTime = null;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.startRetryingForLiveStream();
  }

  /**
   * Handle errors that occur during message polling
   */
  private handlePollingError(error: unknown): void {
    // If polling fails, the stream might have ended - reset and retry
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('liveChatId') || errorMessage.includes('not found')) {
      console.warn(`${this.getConsoleBadge()} Live stream appears to have ended, will retry to find a new one`);
      this.resetAndRetry();
    } else {
      console.error(`${this.getConsoleBadge()} Error polling messages:`, error);
    }
  }

  private async pollMessages(): Promise<void> {
    if (!this.liveChatId || !this.config.apiKey) {
      return;
    }

    try {
      // Request snippet, authorDetails, and potentially emoji/customEmoji data
      let url = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${this.liveChatId}&part=snippet,authorDetails&key=${this.config.apiKey}`;

      if (this.nextPageToken) {
        url += `&pageToken=${this.nextPageToken}`;
      }

      const response = await fetch(url);
      const data = (await response.json()) as YouTubeLiveChatResponse;

      if (data.items) {
        this.setActive(true);

        for (const item of data.items) {
          const message = item.snippet;
          const author = item.authorDetails;

          // Skip if message doesn't have required fields
          if (!item.id || !message || !author) {
            continue;
          }

          // Skip if there's no display message (silent messages like TOMBSTONE)
          if (!message.displayMessage) {
            continue;
          }

          // Skip messages that were sent before the service started
          const messageTimestamp = message.publishedAt ? new Date(message.publishedAt).getTime() : Date.now();
          if (this.serviceStartTime && messageTimestamp < this.serviceStartTime) {
            continue;
          }

          const messageId = `youtube-${item.id}`;

          const emotesMap = this.parseEmotes(message.displayMessage);

          const chatMessage: ChatMessage = {
            id: messageId,
            platform: this.platform,
            channel: this.config.channelId,
            username: author.displayName || author.channelId || 'Unknown',
            message: message.displayMessage,
            timestamp: messageTimestamp,
            avatar: author.profileImageUrl,
            badges: author.isChatModerator ? ['moderator'] : [],
            isModerator: author.isChatModerator === true,
            isSubscriber: author.isChatSponsor === true,
            emotesMap: Object.keys(emotesMap).length > 0 ? emotesMap : undefined,
            metadata: {
              channelId: author.channelId,
              channelUrl: author.channelUrl
            },
          };

          this.emit('messageUpdated', chatMessage);
        }
      }

      if (data.nextPageToken) {
        this.nextPageToken = data.nextPageToken;
      }
    } catch (error) {
      this.setActive(false);
      // If polling fails, the stream might have ended - reset and retry
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('liveChatId') || errorMessage.includes('not found')) {
        console.warn(`${this.getConsoleBadge()} Live stream appears to have ended, will retry to find a new one`);
        this.resetAndRetry();
      } else {
        console.error(`${this.getConsoleBadge()} Error polling messages:`, error);
      }
    }
  }

  async stop(): Promise<void> {
    this.setActive(false);

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }

    this.liveChatId = null;
    this.nextPageToken = null;
    this.isInitialized = false;
    console.log(`${this.getConsoleBadge()} Stopped watching ${this.config.channelId}`);
  }
}

