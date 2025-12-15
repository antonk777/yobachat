import { EventEmitter } from 'node:events';
import chalk from 'chalk';
import WebSocket from 'ws';

import type { ChatMessage, Platform, GoodgameServiceConfig } from '@shared/shared-types.js';
import type { PlatformService, PlatformWithConfig, PlatformServiceEvents } from '@/types.js';

// Goodgame emote interfaces
interface GoodgameEmote {
  name: string;
  animated: boolean;
  img_gif?: string;
  img_big?: string;
}

interface GoodgameGlobalJson {
  Smiles?: GoodgameEmote[];
}

// Goodgame WebSocket message interfaces
interface GoodgameMessage {
  type: string;
  data: Record<string, unknown>;
}

interface GoodgameJoinResponse {
  channel_id: string;
  channel_name: string;
  user_id: number | string;
  name: string;
  access_rights: number;
  [key: string]: unknown;
}

interface GoodgameChatMessage {
  channel_id: string;
  user_id: number;
  user_name: string;
  user_rights: number;
  premium: number;
  premiums?: string[];
  resubs?: Record<string, number>;
  staff: number;
  color: string;
  icon: string;
  role: string;
  mobile: number;
  payments: number;
  paymentsAll?: Record<string, number>;
  gg_plus_tier: number;
  isStatus: number;
  message_id: number | string;
  timestamp: number;
  text: string;
  regtime: number;
}

/**
 * Service for watching Goodgame chat messages using WebSocket
 */
export class GoodgameService extends EventEmitter<PlatformServiceEvents> implements PlatformService {
  public readonly platform: Platform;
  private active: boolean = false;
  private readonly config: GoodgameServiceConfig;
  private logPrefix: string;

  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 1000;
  private isStopping: boolean = false;
  private shouldReconnect: boolean = false;

  // Goodgame WebSocket URL
  private readonly wsUrl = 'wss://chat-1.goodgame.ru/chat2/';

  // Emote cache
  private emotesMap: Map<string, string> = new Map();
  private readonly globalJsonUrl = 'https://static.goodgame.ru/js/minified/global.json';

  constructor(platformConfig: PlatformWithConfig) {
    super();

    this.platform = {
      id: platformConfig.id,
      name: platformConfig.name,
      color: platformConfig.color,
      abbr: platformConfig.abbr
    };

    this.config = platformConfig.config as GoodgameServiceConfig;

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

    console.log(`${this.logPrefix} Starting service for channel: ${this.config.channelId}`);

    this.isStopping = false;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;

    // Load emotes before connecting
    await this.loadEmotes();

    await this.connectWebSocket();
  }

  async stop(): Promise<void> {
    if (!this.active && !this.ws) {
      return;
    }

    console.log(`${this.logPrefix} Stopping service for channel: ${this.config.channelId}`);

    this.isStopping = true;
    this.shouldReconnect = false;
    this.setActive(false);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.removeAllListeners();

        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch (error) {
        // Ignore errors during cleanup
      }

      this.ws = null;
    }

    console.log(`${this.logPrefix} Stopped watching ${this.config.channelId}`);
  }

  /**
   * Connect to Goodgame WebSocket
   */
  private async connectWebSocket(): Promise<void> {
    if (this.isStopping || !this.shouldReconnect) {
      return;
    }

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch (error) {
        // Ignore errors
      }

      this.ws = null;
    }

    try {
      console.log(`${this.logPrefix} Connecting to Goodgame WebSocket...`);
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        console.log(`${this.logPrefix} Connected to Goodgame WebSocket`);
        this.reconnectAttempts = 0;
        // Wait for welcome message before joining channel
      });

      this.ws.on('message', (data: Buffer | string) => {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        this.handleWebSocketMessage(buffer);
      });

      this.ws.on('error', (error: Error) => {
        console.error(`${this.logPrefix} WebSocket error:`, error);

        this.setActive(false);

        if (!this.isStopping && this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        console.log(`${this.logPrefix} WebSocket closed (${code}: ${reason?.toString() || 'no reason'})`);

        this.setActive(false);

        if (!this.isStopping && this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });

    } catch (error) {
      console.error(`${this.logPrefix} Error creating WebSocket connection:`, error);

      this.setActive(false);

      if (!this.isStopping && this.shouldReconnect) {
        this.scheduleReconnect();
      }

      throw error;
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(data: Buffer): void {
    try {
      const messageStr = data.toString('utf-8');
      const message = JSON.parse(messageStr) as GoodgameMessage;

      // Handle welcome message
      if (message.type === 'welcome') {
        console.log(`${this.logPrefix} Received welcome message, joining channel...`);
        this.joinChannel();
        return;
      }

      // Handle successful join
      if (message.type === 'success_join') {
        const joinData = message.data as GoodgameJoinResponse;
        console.log(`${this.logPrefix} Successfully joined channel: ${joinData.channel_name || joinData.channel_id}`);
        this.setActive(true);
        return;
      }

      // Handle chat messages
      if (message.type === 'message') {
        try {
          const chatData = message.data as unknown as GoodgameChatMessage;
          this.processChatMessage(chatData);
        } catch (error) {
          console.error(`${this.logPrefix} Error parsing chat message:`, error);
        }
        return;
      }

      // Handle errors
      if (message.type === 'error') {
        const errorData = message.data as { errorMsg?: string; channel_id?: string };
        console.error(`${this.logPrefix} Server error: ${errorData.errorMsg || 'Unknown error'}`);
        return;
      }

      // Log other message types for debugging (optional)
      // console.log(`${this.logPrefix} Received message type: ${message.type}`);

    } catch (error) {
      console.error(`${this.logPrefix} Error handling WebSocket message:`, error);
    }
  }

  /**
   * Join the channel
   */
  private joinChannel(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const joinMessage: GoodgameMessage = {
      type: 'join',
      data: {
        channel_id: this.config.channelId,
        hidden: 0,
        mobile: false,
        reload: false
      }
    };

    console.log(`${this.logPrefix} Joining channel: ${this.config.channelId}`);

    this.ws.send(JSON.stringify(joinMessage));
  }

  /**
   * Load emotes from Goodgame global.json
   */
  private async loadEmotes(): Promise<void> {
    try {
      console.log(`${this.logPrefix} Loading emotes from ${this.globalJsonUrl}...`);
      const response = await fetch(this.globalJsonUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} - ${response.statusText}`);
      }

      const data = (await response.json()) as GoodgameGlobalJson;

      this.emotesMap.clear();

      if (data.Smiles && Array.isArray(data.Smiles)) {
        for (const emote of data.Smiles) {
          if (!emote.name) {
            continue;
          }

          // Prefer animated GIF if available and emote is animated, otherwise use static PNG
          let emoteUrl: string | undefined;

          if (emote.animated && emote.img_gif) {
            emoteUrl = emote.img_gif;
          } else if (emote.img_big) {
            emoteUrl = emote.img_big;
          } else if (emote.img_gif) {
            emoteUrl = emote.img_gif;
          }

          if (emoteUrl) {
            this.emotesMap.set(emote.name, emoteUrl);
          }
        }
      }

      console.log(`${this.logPrefix} Loaded ${this.emotesMap.size} emotes`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`${this.logPrefix} Failed to load emotes: ${errorMessage}`);
      this.emotesMap.clear();
    }
  }

  /**
   * Parse emote patterns in message text
   * Goodgame uses :emotename: format for emotes
   */
  private parseEmotes(text: string): Record<string, string> {
    const emotesMap: Record<string, string> = {};

    // Pattern: :emotename: (matches emotes like :jokie5:, :scarypeka:, etc.)
    const emoteRegex = /:([a-zA-Z0-9_-]+):/g;

    let match: RegExpExecArray | null = null;

    while ((match = emoteRegex.exec(text)) !== null) {
      const [fullEmote, emoteName] = match; // The full :emotename: string

      if (!emotesMap[fullEmote] && emoteName) {
        // Look up emote URL from cached emotes map
        const emoteUrl = this.emotesMap.get(emoteName);
        if (emoteUrl) {
          emotesMap[fullEmote] = emoteUrl;
        }
      }
    }

    return emotesMap;
  }

  /**
   * Map Goodgame user rights to badges
   */
  private mapUserRights(rights: number): string[] {
    const badges: string[] = [];

    // Rights levels from documentation:
    // 0 = casual (Обычный)
    // 10 = stream_moder (Помощник стримера)
    // 20 = streamer (Стример)
    // 30 = moderator (Модератор)
    // 40 = smoderator (Супермодератор)
    // 50 = admin (Администратор)

    if (rights >= 50) {
      badges.push('admin');
    } else if (rights >= 40) {
      badges.push('smoderator');
    } else if (rights >= 30) {
      badges.push('moderator');
    } else if (rights >= 20) {
      badges.push('streamer');
    } else if (rights >= 10) {
      badges.push('stream_moder');
    }

    return badges;
  }

  /**
   * Process chat message from WebSocket event
   */
  private processChatMessage(data: GoodgameChatMessage): void {
    const emotesMap = this.parseEmotes(data.text);
    const badges = this.mapUserRights(data.user_rights);

    // Add premium badge if user has premium
    if (data.premium === 1 || (data.premiums && data.premiums.length > 0)) {
      badges.push('premium');
    }

    // Add staff badge if user is staff
    if (data.staff === 1) {
      badges.push('staff');
    }

    const messageId = `goodgame-${data.message_id}`;

    const chatMessage: ChatMessage = {
      id: messageId,
      platform: this.platform,
      channel: data.channel_id,
      username: data.user_name,
      message: data.text,
      emotesMap: Object.keys(emotesMap).length > 0 ? emotesMap : undefined,
      timestamp: data.timestamp * 1000, // Convert Unix timestamp to milliseconds
      color: data.color && data.color !== 'none' ? data.color : undefined,
      badges: badges.length > 0 ? badges : undefined,
      isModerator: data.user_rights >= 10,
      metadata: {
        userId: data.user_id,
        userRights: data.user_rights,
        premium: data.premium,
        premiums: data.premiums,
        payments: data.payments,
        paymentsAll: data.paymentsAll,
        ggPlusTier: data.gg_plus_tier,
        staff: data.staff,
        icon: data.icon,
        role: data.role,
        regtime: data.regtime
      },
    };

    this.emit('messageUpdated', chatMessage);
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.isStopping || !this.shouldReconnect || this.reconnectTimer) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`${this.logPrefix} Max reconnection attempts reached. Stopping reconnection.`);
      this.shouldReconnect = false;
      return;
    }

    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 60000);
    this.reconnectAttempts++;

    console.log(`${this.logPrefix} Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isStopping && this.shouldReconnect) {
        this.connectWebSocket().catch(error => {
          console.error(`${this.logPrefix} Reconnection failed:`, error);
        });
      }
    }, delay);
  }
}
