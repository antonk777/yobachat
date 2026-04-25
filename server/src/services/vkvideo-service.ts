import { Centrifuge } from 'centrifuge';
import { EventEmitter } from 'node:events';
import chalk from 'chalk';
import WebSocket from 'ws';

import type { ChatMessage, Platform, VKVideoServiceConfig } from '@shared/shared-types.js';
import type { PlatformService, PlatformWithConfig, PlatformServiceEvents } from '@/types.js';

import { kVKVideoColors } from '@/constants/vkvideo.js';


const kAPIBaseURL = 'https://apidev.live.vkvideo.ru';
const kWebSocketURL = 'wss://pubsub-dev.live.vkvideo.ru/connection/websocket?format=json&cf_protocol_version=v2';

// Retry configuration
const kRetryConfig = {
  maxRetries: Infinity, // Retry indefinitely
  initialDelay: 1000, // 1 second
  maxDelay: 60000, // 60 seconds
  backoffMultiplier: 2, // Double delay on each retry
} as const;

interface ChannelInfo {
  id: number;
  web_socket_channels: {
    chat: string;
    info: string;
    channel_points: string;
    limited_chat: string;
    private_chat: string;
    // ... other channel types
  };
}

interface StreamInfo {
  id: string;
  title: string;
  status: string;
}

interface VKBadge {
  id: string;
  name: string;
  achievement_name: string;
  small_url: string;
  medium_url: string;
  large_url: string;
}

interface VKAuthor {
  id: number;
  nick: string;
  nick_color: number;
  avatar_url: string;
  is_moderator: boolean;
  is_owner: boolean;
  badges: VKBadge[];
  roles: any[];
}

interface VKMessagePart {
  text?: {
    content: string;
  };
  smile?: {
    name: string;
    small_url: string;
    medium_url: string;
    animated: boolean;
    id: string;
    large_url: string;
  }
}

interface VKChatMessage {
  id: number;
  created_at: number;
  author: VKAuthor;
  parts: VKMessagePart[];
  is_private: boolean;
}

interface VKMessageSendData {
  chat_message: VKChatMessage;
}

interface VKMessageDeleteData {
  chat_message: {
    id: number;
  };
}

interface ChannelResponse {
  data: {
    channel: ChannelInfo;
    stream: StreamInfo | null;
  };
}

/**
 * Service for watching VK Video Live chat messages
 */
export class VKVideoService extends EventEmitter<PlatformServiceEvents> implements PlatformService {
  public readonly platform: Platform;
  private active: boolean = false;
  private logPrefix: string;

  private centrifuge: Centrifuge | null = null;
  private readonly config: VKVideoServiceConfig;
  private retryCount: number = 0;
  private retryTimeout: NodeJS.Timeout | null = null;
  private isStopping: boolean = false;
  private shouldReconnect: boolean = false;

  constructor(platformConfig: PlatformWithConfig<VKVideoServiceConfig>) {
    super();

    this.platform = {
      id: platformConfig.id,
      name: platformConfig.name,
      color: platformConfig.color,
      abbr: platformConfig.abbr
    };

    this.config = platformConfig.config as VKVideoServiceConfig;

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

  async start(): Promise<void> {
    if (this.active) {
      return;
    }

    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error('VK Video client ID and secret are required');
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

    // Clean up existing centrifuge client if any
    if (this.centrifuge) {
      try {
        this.centrifuge.disconnect();
      } catch (error) {
        // Ignore disconnect errors
      }
      this.centrifuge = null;
    }

    try {
      const wsToken = await this.getWebSocketToken();
      this.centrifuge = new Centrifuge(kWebSocketURL, {
        token: wsToken,
        // Node runtime does not always expose a global WebSocket constructor.
        websocket: WebSocket,
      });

      this.setupEventHandlers();
      this.centrifuge.connect();

      await this.waitForConnection();

      // Connection successful - reset retry count
      this.retryCount = 0;
    } catch (error) {
      console.error(`${this.logPrefix} Error connecting to ${this.config.channelId}:`, error);
      this.setActive(false);
      this.scheduleRetry();
    }
  }

  private getAuthHeaders() {
    const credentials = `${this.config.clientId}:${this.config.clientSecret}`;
    const authToken = Buffer.from(credentials).toString('base64');
    return {
      'Authorization': `Basic ${authToken}`,
      'Content-Type': 'application/json'
    };
  }

  private setupEventHandlers() {
    if (!this.centrifuge) return;

    let isSubscribed = false;

    this.centrifuge.on('connected', () => {
      console.log(`${this.logPrefix} Connected to WebSocket`);
      this.setActive(true);
      this.retryCount = 0; // Reset retry count on successful connection

      if (!isSubscribed) {
        isSubscribed = true;
        this.getStreamInfoAndSubscribe().catch(error => {
          console.error(`${this.logPrefix} Failed to subscribe to chat:`, error);
          this.setActive(false);
          // Schedule retry on subscription failure
          if (!this.isStopping && this.shouldReconnect) {
            this.scheduleRetry();
          }
        });
      }
    });

    this.centrifuge.on('disconnected', (ctx) => {
      console.log(`${this.logPrefix} Disconnected from WebSocket (${ctx?.code}: ${ctx?.reason})`);
      this.setActive(false);
      isSubscribed = false;

      // Only attempt reconnection if we're not stopping and should reconnect
      if (!this.isStopping && this.shouldReconnect) {
        console.log(`${this.logPrefix} Scheduling reconnection...`);
        this.scheduleRetry();
      }
    });

    this.centrifuge.on('error', (error) => {
      console.error(`${this.logPrefix} WebSocket error:`, error);
      this.setActive(false);

      // Only attempt reconnection if we're not stopping and should reconnect
      if (!this.isStopping && this.shouldReconnect) {
        console.log(`${this.logPrefix} Scheduling reconnection...`);
        this.scheduleRetry();
      }
    });
  }

  private async waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 15000);

      const checkConnection = () => {
        if (this.active) {
          clearTimeout(timeout);
          resolve();
        } else if (!this.centrifuge) {
          clearTimeout(timeout);
          reject(new Error('Centrifuge client was destroyed'));
        } else {
          setTimeout(checkConnection, 100);
        }
      };

      checkConnection();
    });
  }

  private async getChannelInfo(): Promise<ChannelInfo | null> {
    const response = await fetch(`${kAPIBaseURL}/v1/channel?channel_url=${this.config.channelId}`, {
      method: 'GET',
      headers: this.getAuthHeaders()
    });

    if (response.ok) {
      const data = await response.json() as ChannelResponse;
      return data.data.channel;
    }

    return null;
  }

  private async getWebSocketToken(): Promise<string> {
    const response = await fetch(`${kAPIBaseURL}/v1/websocket/token`, {
      method: 'GET',
      headers: this.getAuthHeaders()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get WebSocket token: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as { data: { token: string } };
    return data.data.token;
  }

  private async getStreamInfoAndSubscribe(): Promise<void> {
    if (!this.centrifuge) {
      throw new Error('Centrifuge client not initialized');
    }

    const channelInfo = await this.getChannelInfo();
    if (!channelInfo?.web_socket_channels?.chat) {
      throw new Error('Channel info not available or missing WebSocket chat channel');
    }

    const chatChannelId = channelInfo.web_socket_channels.chat;

    console.log(`${this.logPrefix} Subscribing to chat channel: ${chatChannelId}`);

    const sub = this.centrifuge.newSubscription(chatChannelId);

    sub.on('publication', (ctx) => {
      this.handleChatMessage(ctx.data);
    });

    sub.on('error', (error) => {
      console.error(`${this.logPrefix} Subscription error:`, error);
    });

    sub.subscribe();
  }

  private handleChatMessage(data: any): void {
    try {
      // console.log(`${this.logPrefix} Chat message send:`, JSON.stringify(data, null, 2));

      if (data.type === 'channel_chat_message_send' && data.data?.chat_message) {
        // Handle new chat messages
        this.handleChatMessageSend(data.data as VKMessageSendData);
      } else if (data.type === 'channel_chat_message_delete' && data.data) {
        // Handle deleted chat messages
        this.handleChatMessageDelete(data.data as VKMessageDeleteData);
      }
    } catch (error) {
      console.error(`${this.logPrefix} Error handling chat message:`, error);
    }
  }

  private handleChatMessageSend(data: VKMessageSendData): void {
    const msg = data.chat_message;

    const emotesMap: Record<string, string> = {};

    // Extract message content
    const messageText = msg.parts
      .map(part => {
        if (part.smile) {
          emotesMap[part.smile.name] = part.smile.medium_url;
          return part.smile.name;
        }

        if (part.text && part.text.content !== '\n') {
          return part.text.content;
        }

        return null;
      })
      .filter(Boolean)
      .join('')
      .trim();

    const username = msg.author.nick;

    if (!messageText || !username) {
      // console.log(`${this.logPrefix} ⚠️ Skipping message - no content or username found`);
      return;
    }

    const messageId = `vkvideo-${msg.id}`;

    // Extract badges
    const badges = msg.author.badges
      .map(badge => badge.achievement_name || badge.name)
      .filter(Boolean);

    // console.log(`${this.logPrefix} Author:`, msg.author);

    const color = kVKVideoColors[msg.author.nick_color] ?? undefined;

    const chatMessage: ChatMessage = {
      id: messageId,
      platform: this.platform,
      channel: this.config.channelId,
      username,
      message: messageText,
      timestamp: msg.created_at * 1000,
      emotesMap,
      avatar: msg.author.avatar_url,
      badges,
      color,
      isModerator: msg.author.is_moderator,
      isSubscriber: badges.includes('paid_subscriber'),
      metadata: {
        userId: msg.author.id,
        channelId: this.config.channelId,
        messageType: 'channel_chat_message_send',
        isPrivate: msg.is_private
      }
    };

    this.emit('messageUpdated', chatMessage);
  }

  private handleChatMessageDelete(data: VKMessageDeleteData): void {
    const messageId = data.chat_message.id;

    this.emit('messageDeleted', {
      id: messageId.toString()
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

    // Increment retry count first, then calculate delay with exponential backoff
    this.retryCount++;
    const delay = Math.min(
      kRetryConfig.initialDelay * Math.pow(kRetryConfig.backoffMultiplier, this.retryCount - 1),
      kRetryConfig.maxDelay
    );

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

    if (!this.centrifuge) {
      return;
    }

    try {
      this.centrifuge.disconnect();
      this.centrifuge = null;
      this.setActive(false);
      this.retryCount = 0;
      console.log(`${this.logPrefix} Stopped watching ${this.config.channelId}`);
    } catch (error) {
      console.error(`${this.logPrefix} Error stopping service:`, error);
      // Still mark as stopped even if disconnect fails
      this.centrifuge = null;
      this.setActive(false);
    }
  }
}
