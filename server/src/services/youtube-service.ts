import { EventEmitter } from 'node:events';
import chalk from 'chalk';
import { Innertube } from 'youtubei.js/web';
import { YTNodes } from 'youtubei.js/web';
import type LiveChat from 'youtubei.js/dist/src/parser/youtube/LiveChat.js';
import type LiveChatTextMessage from 'youtubei.js/dist/src/parser/classes/livechat/items/LiveChatTextMessage.js';
import type EmojiRun from 'youtubei.js/dist/src/parser/classes/misc/EmojiRun.js';
import type TextRun from 'youtubei.js/dist/src/parser/classes/misc/TextRun.js';

import type { ChatMessage, Platform, YouTubeServiceConfig } from '@shared/shared-types.js';
import type {
  PlatformService,
  PlatformWithConfig,
  PlatformServiceEvents,
} from '@/types.js';
import { kYouTubeEmoteMapping } from '@/constants/youtube.js';
import { randomUUID } from 'node:crypto';


/**
 * Service for watching YouTube live chat messages
 */
export class YouTubeService extends EventEmitter<PlatformServiceEvents> implements PlatformService {
  public readonly platform: Platform;
  private active: boolean = false;
  private readonly config: YouTubeServiceConfig;
  private logPrefix: string;

  private retryInterval: NodeJS.Timeout | null = null;
  private isInitialized: boolean = false;
  private retryDelay: number = 15000; // Start at 15s, will increase up to 120s
  private liveChat: LiveChat | null = null; // youtubei.js LiveChat instance
  private currentVideoId: string | null = null;
  private readonly defaultRetryDelayMs = 15000;
  private readonly minRetryDelayMs = 1000;
  private readonly maxRetryDelayMs = 120000;

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

  /**
   * Parse YouTube emotes/emojis from message runs array and create a mapping to image URLs
   * Processes runs array to extract text and emoji codes, then maps emojis to image URLs
   * Returns both the joined text string and the emotesMap
   */
  private parseEmotes(runs: (EmojiRun | TextRun)[] | undefined, fallbackText?: string): { text: string; emotesMap: Record<string, string> } {
    const emotesMap: Record<string, string> = {};
    let text = '';

    // Process runs array if available
    if (runs && Array.isArray(runs)) {
      text = runs.map((run: EmojiRun | TextRun) => {
        // Check if it's an EmojiRun (has emoji property)
        if ('emoji' in run && run.emoji) {
          // EmojiRun - extract emoji code from shortcuts and map to URL
          let emojiCode = '';

          // Get emoji code from shortcuts (e.g., :emoji_name:)
          if (run.emoji.shortcuts && Array.isArray(run.emoji.shortcuts) && run.emoji.shortcuts.length > 0) {
            emojiCode = run.emoji.shortcuts[0];
          } else if (run.text) {
            // Fallback to text property if shortcuts not available
            emojiCode = run.text;
          }

          // Map emoji to URL if available
          if (emojiCode) {
            // Extract emoji name from code (remove : : around it)
            const emojiName = emojiCode.replace(/^:/, '').replace(/:$/, '');
            const emoteUrl = kYouTubeEmoteMapping[emojiName.toLowerCase()];

            if (emoteUrl) {
              emotesMap[emojiCode] = emoteUrl;
            }

            return emojiCode;
          }
        }

        // TextRun - use text as-is
        if (run.text) {
          return run.text;
        }

        return '';
      }).join('');
    } else if (fallbackText) {
      // Fallback: parse text string for emotes
      text = fallbackText;

      // Regular expression to match custom YouTube emotes in :emotename: format
      const customEmoteRegex = /:([a-zA-Z0-9_-]+):/g;
      const customEmoteMatches = text.matchAll(customEmoteRegex);

      for (const match of customEmoteMatches) {
        const [fullEmote, emoteName] = match;

        if (emoteName && !emotesMap[fullEmote]) {
          const emoteUrl = kYouTubeEmoteMapping[emoteName.toLowerCase()];
          if (emoteUrl) {
            emotesMap[fullEmote] = emoteUrl;
          }
        }
      }
    }

    return { text, emotesMap };
  }

  async start(): Promise<void> {
    if (this.active) {
      return;
    }

    console.log(`${this.logPrefix} Started watching ${this.config.channelId} - will retry until a live stream is found`);

    // Start retrying to find a live stream
    this.startRetryingForLiveStream();
  }

  /**
   * Start retrying to find a live stream periodically
   */
  private startRetryingForLiveStream(resetBackoff: boolean = true): void {
    // Reset retry delay only when starting fresh; keep backoff on repeated failures
    if (resetBackoff) {
      this.retryDelay = this.defaultRetryDelayMs;
    }

    // Try immediately first
    this.tryInitializeLiveChat();

    // Schedule next retry with progressive falloff
    this.scheduleNextRetry();
  }

  /**
   * Schedule the next retry with exponential falloff (up to 120s)
   */
  private scheduleNextRetry(): void {
    if (this.retryInterval) {
      clearTimeout(this.retryInterval);
      this.retryInterval = null;
    }

    const delay = this.getSafeRetryDelay(this.retryDelay);
    this.retryDelay = delay;

    this.retryInterval = setTimeout(() => {
      if (!this.isInitialized) {
        this.tryInitializeLiveChat();
        // Exponentially increase delay for next retry (capped at 120s)
        const newDelay = this.retryDelay * 2;
        this.retryDelay = this.getSafeRetryDelay(newDelay);
        this.scheduleNextRetry();
      }
    }, delay);
  }

  /**
   * Returns a safe timeout delay that is always a finite positive integer.
   */
  private getSafeRetryDelay(value: unknown): number {
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return this.defaultRetryDelayMs;
    }

    const clamped = Math.max(this.minRetryDelayMs, Math.min(numericValue, this.maxRetryDelayMs));
    return Math.round(clamped);
  }

  /**
   * Try to initialize the live chat, but don't throw errors
   * Based on: https://github.com/ixnoahlive/youtube-websocket/blob/main/src/routes/channel.ts
   */
  private async tryInitializeLiveChat(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Format channel ID - handle both UC... format and @handle format
      const niceId = /^UC.{22}$/.test(this.config.channelId)
        ? this.config.channelId
        : '@' + this.config.channelId.replace('@', '');

      // Use youtubei.js to resolve the channel's live stream URL
      const youtube = await Innertube.create();
      const streamData = await youtube.resolveURL(`https://www.youtube.com/${niceId}/live`).catch(() => {
        return null;
      });

      if (!streamData?.payload?.videoId) {
        // No live stream yet, will retry
        return;
      }

      const videoId = streamData.payload.videoId;
      this.currentVideoId = videoId;
      this.isInitialized = true;

      // Stop retrying
      if (this.retryInterval) {
        clearTimeout(this.retryInterval);
        this.retryInterval = null;
      }
      // Reset retry delay for next time
      this.retryDelay = this.defaultRetryDelayMs;

      // Connect with youtubei.js (real-time)
      this.connectWithYoutubei(videoId).catch((error) => {
        console.error(`${this.logPrefix} Failed to connect with youtubei.js:`, error);
        // Reset and retry
        this.resetAndRetry(true);
      });
    } catch (error) {
      this.setActive(false);
      // Silently fail and retry later
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('Could not find stream') && !errorMessage.includes('no available live chat')) {
        console.error(`${this.logPrefix} Error checking for live stream:`, error);
      }
    }
  }

  /**
   * Connect to YouTube live chat using youtubei.js (real-time method)
   * Based on: https://github.com/ixnoahlive/youtube-websocket/blob/main/src/utils/finaliseStream.ts
   */
  private async connectWithYoutubei(streamId: string): Promise<void> {
    try {
      const youtube = await Innertube.create();
      const streamInfo = await youtube.getInfo(streamId);
      const liveChat = streamInfo.getLiveChat();

      if (!liveChat) {
        throw new Error('Requested content has no available live chat');
      }

      this.liveChat = liveChat;

      // Listen for chat updates
      liveChat.on('chat-update', (action) => {
        if (!this.isInitialized || !action.is(YTNodes.AddChatItemAction)) {
          return;
        }

        const item = action.as(YTNodes.AddChatItemAction).item;

        if (!item) {
          return;
        }

        // Handle different message types
        switch (item.type) {
          case 'LiveChatTextMessage':
            this.handleLiveChatTextMessage(item.as(YTNodes.LiveChatTextMessage));
            break;

          case 'LiveChatPaidMessage':
            // Handle superchat/membership messages if needed
            break;
        }
      });

      // Handle live chat end
      liveChat.on('end', () => {
        console.warn(`${this.logPrefix} Live chat has ended`);
        if (this.liveChat) {
          this.liveChat.stop();
          this.liveChat = null;
        }
        this.resetAndRetry(true);
      });

      // Critical: prevent unhandled EventEmitter 'error' from crashing the process.
      liveChat.on('error', (error: unknown) => {
        console.error(`${this.logPrefix} Live chat runtime error:`, error);
        if (this.liveChat) {
          try {
            this.liveChat.stop();
          } catch {
            // Ignore stop errors on broken chat instances.
          }
          this.liveChat = null;
        }
        this.resetAndRetry(true);
      });

      // Start the live chat
      liveChat.start();

      console.log(`${this.logPrefix} Connected with youtubei.js! Live stream found! Started watching chat for ${this.config.channelId} (real-time)`);
      this.setActive(true);
    } catch (error) {
      if (this.liveChat) {
        try {
          this.liveChat.stop();
        } catch (e) {
          // Ignore errors when stopping
        }
        this.liveChat = null;
      }
      throw error;
    }
  }

  /**
   * Handle LiveChatTextMessage from youtubei.js
   * Based on the structure from youtubei.js LiveChatTextMessage node
   */
  private handleLiveChatTextMessage(message: LiveChatTextMessage): void {
    try {
      // Extract message ID
      const messageId = message.id || `youtube-${randomUUID()}`;

      // Parse emotes from runs array - returns both text and emotesMap
      const { text, emotesMap } = this.parseEmotes(
        message.message?.runs,
        message.message?.text
      );

      if (!text || !text.trim()) {
        return; // Skip empty messages
      }

      // Get author information
      const author = message.author;

      let
        authorName = '',
        authorId = '',
        authorThumbnail: string | undefined,
        isModerator = false,
        isVerified = false,
        isOwner = false;

      if (author) {
        // Author.name is a string
        authorName = author.name || '';
        authorId = author.id || '';

        // Get thumbnail from thumbnails array
        if (author.thumbnails && author.thumbnails.length > 0) {
          // Use best_thumbnail if available, otherwise first thumbnail
          const thumbnail = author.best_thumbnail || author.thumbnails[0];
          authorThumbnail = thumbnail?.url;
        }

        // Check for moderator/verified status
        isModerator = author.is_moderator || false;
        isVerified = author.is_verified || false;
        isOwner = author.is_verified_artist || false;
      }

      // Get timestamp - timestamp is in seconds, timestamp_usec is in microseconds
      let timestamp = Date.now();

      if (message.timestamp_usec) {
        timestamp = Math.floor(message.timestamp_usec / 1000);
      } else if (message.timestamp) {
        timestamp = message.timestamp * 1000;
      }

      // Build chat message
      const chatMessage: ChatMessage = {
        id: `youtube-${messageId}`,
        platform: this.platform,
        channel: this.config.channelId,
        username: authorName,
        message: text,
        timestamp: timestamp,
        avatar: authorThumbnail,
        badges: [
          ...(isModerator ? ['moderator'] : []),
          ...(isVerified ? ['verified'] : []),
          ...(isOwner ? ['owner'] : [])
        ],
        isModerator: isModerator,
        emotesMap: Object.keys(emotesMap).length > 0 ? emotesMap : undefined,
        metadata: {
          channelId: authorId,
          verified: isVerified
        }
      };

      this.emit('messageUpdated', chatMessage);
    } catch (error) {
      console.error(`${this.logPrefix} Error handling LiveChatTextMessage:`, error);
    }
  }


  /**
   * Reset the service and start retrying for a new live stream
   */
  private resetAndRetry(increaseBackoff: boolean = false): void {
    this.isInitialized = false;
    this.currentVideoId = null;

    if (this.retryInterval) {
      clearTimeout(this.retryInterval);
      this.retryInterval = null;
    }

    if (this.liveChat) {
      try {
        this.liveChat.stop();
      } catch (error) {
        // Ignore errors when stopping
      }
      this.liveChat = null;
    }

    if (increaseBackoff) {
      this.retryDelay = this.getSafeRetryDelay(this.retryDelay * 2);
    } else {
      this.retryDelay = this.defaultRetryDelayMs;
    }

    this.startRetryingForLiveStream(false);
  }

  async stop(): Promise<void> {
    this.setActive(false);

    if (this.retryInterval) {
      clearTimeout(this.retryInterval);
      this.retryInterval = null;
    }

    if (this.liveChat) {
      try {
        this.liveChat.stop();
      } catch (error) {
        // Ignore errors when stopping
      }
      this.liveChat = null;
    }

    this.isInitialized = false;
    this.currentVideoId = null;
    console.log(`${this.logPrefix} Stopped watching ${this.config.channelId}`);
  }
}

