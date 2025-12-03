import { EventEmitter } from 'node:events';
import chalk from 'chalk';

import type { ChatMessage, Platform, KickServiceConfig } from '@shared/shared-types.js';
import type { PlatformService, PlatformWithConfig, PlatformServiceEvents } from '@/types.js';

// Kick API interfaces based on the REST API

interface KickBadge {
  type: string
  text: string
  count?: number
}

interface KickSender {
  id: number
  username: string
  slug: string
  identity: {
    color: string
    badges: KickBadge[]
  }
}

interface KickMessage {
  id: string
  chat_id: number
  user_id: number
  username: string
  content: string
  type: string
  created_at: string
  sender: KickSender
}

interface KickResponse {
  data: {
    messages: KickMessage[]
  }
}

/**
 * Service for watching Kick chat messages using REST API polling
 */
export class KickService extends EventEmitter<PlatformServiceEvents> implements PlatformService {
  public readonly platform: Platform;
  private active: boolean = false;
  private readonly config: KickServiceConfig;
  private logPrefix: string;

  private chatId: number | null = null;
  private lastMessageId: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private cookies: string | null = null;

  constructor(platformConfig: PlatformWithConfig) {
    super();

    this.platform = {
      id: platformConfig.id,
      name: platformConfig.name,
      color: platformConfig.color,
      abbr: platformConfig.abbr
    };

    this.config = platformConfig.config as KickServiceConfig;

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

    console.log(`${this.logPrefix} Starting service for channel: ${this.config.channel}`);

    try {
      // Assume channel config contains the correct chat ID
      this.chatId = parseInt(this.config.channel);
      if (isNaN(this.chatId) || this.chatId <= 0) {
        throw new Error(`Invalid chat ID: ${this.config.channel}`);
      }

      console.log(`${this.logPrefix} Using chat ID: ${this.chatId}`);

      this.setActive(true);
      this.lastMessageId = null; // Reset message tracking

      // Start polling for messages
      this.startPolling();

      console.log(`${this.logPrefix} Service started for ${this.config.channel}`);
    } catch (error) {
      console.error(`${this.logPrefix} Error starting service for ${this.config.channel}:`, error);
      this.setActive(false);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.active) {
      return;
    }

    console.log(`${this.logPrefix} Stopping service for ${this.config.channel}`);

    this.setActive(false);

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    console.log(`${this.logPrefix} Stopped watching ${this.config.channel}`);
  }

  private startPolling(): void {
    console.log(`${this.logPrefix} Starting polling for chat messages every ${this.config.pollInterval}ms`);

    this.pollTimer = setInterval(async () => {
      if (!this.active || !this.chatId) {
        return;
      }

      try {
        await this.pollMessages();
      } catch (error) {
        console.error(`${this.logPrefix} Error polling messages for ${this.config.channel}:`, error);
        // Continue polling even on errors
      }
    }, this.config.pollInterval);
  }

  private async pollMessages(): Promise<void> {
    if (!this.chatId) {
      return;
    }

    const apiUrl = `https://web.kick.com/api/v1/chat/${this.chatId}/history`;

    try {
      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as KickResponse;

      if (data.data?.messages) {
        // Process messages in chronological order (oldest first)
        const newMessages = data.data.messages.filter(msg => !this.lastMessageId || msg.id > this.lastMessageId);

        for (const message of newMessages) {
          this.processChatMessage(message);
        }

        // Update last message ID
        if (newMessages.length > 0) {
          this.lastMessageId = newMessages[newMessages.length - 1].id;
        }
      }
    } catch (error) {
      // Don't throw here, just log - we want polling to continue
      console.error(`${this.logPrefix} Error fetching messages for ${this.config.channel}:`, error);
    }
  }

  private processChatMessage(data: KickMessage): void {
    const chatMessage: ChatMessage = {
      id: data.id,
      platform: this.platform,
      channel: this.config.channel,
      username: data.sender.username,
      message: data.content,
      timestamp: new Date(data.created_at).getTime(),
      color: data.sender.identity?.color || undefined,
      avatar: undefined, // API doesn't provide avatar
      badges: data.sender.identity?.badges?.map(badge => badge.type) || [],
      metadata: {
        userId: data.sender.id,
        chatId: this.chatId,
        slug: data.sender.slug,
        badges: data.sender.identity?.badges || [],
      },
    };

    this.emit('messageUpdated', chatMessage);
  }
}
