import { EventEmitter } from 'node:events';
import chalk from 'chalk';
// Note: uWebSockets.js is server-only, so we use 'ws' for client WebSocket connections
import WebSocket from 'ws';

import type { ChatMessage, Platform, KickServiceConfig } from '@shared/shared-types.js';
import type { PlatformService, PlatformWithConfig, PlatformServiceEvents } from '@/types.js';

// Kick Pusher WebSocket interfaces
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

interface KickChatMessageEvent {
  id: string
  chatroom_id: number
  content: string
  type: string
  created_at: string
  sender: KickSender
  metadata?: {
    message_ref?: string
  }
}

interface PusherMessage {
  event: string
  data: string
  channel: string
}

interface PusherSubscribeMessage {
  event: 'pusher:subscribe'
  data: {
    auth: string
    channel: string
  }
}

/**
 * Service for watching Kick chat messages using Pusher WebSocket
 */
export class KickService extends EventEmitter<PlatformServiceEvents> implements PlatformService {
  public readonly platform: Platform;
  private active: boolean = false;
  private readonly config: KickServiceConfig;
  private logPrefix: string;

  private chatroomId: number | null = null;
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 1000;
  private isStopping: boolean = false;
  private shouldReconnect: boolean = false;
  private readonly pingInterval: number = 120000; // 2 minutes in milliseconds

  // Pusher WebSocket URL
  private readonly pusherUrl = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false';

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
      // Get chatroom ID from channel name or use channel if it's already an ID
      await this.resolveChatroomId();

      if (!this.chatroomId) {
        throw new Error(`Failed to resolve chatroom ID for channel: ${this.config.channel}`);
      }

      console.log(`${this.logPrefix} Using chatroom ID: ${this.chatroomId}`);

      this.isStopping = false;
      this.shouldReconnect = true;
      this.reconnectAttempts = 0;

      await this.connectWebSocket();

      console.log(`${this.logPrefix} Service started for ${this.config.channel}`);
    } catch (error) {
      console.error(`${this.logPrefix} Error starting service for ${this.config.channel}:`, error);
      this.setActive(false);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.active && !this.ws) {
      return;
    }

    console.log(`${this.logPrefix} Stopping service for ${this.config.channel}`);

    this.isStopping = true;
    this.shouldReconnect = false;
    this.setActive(false);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
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

    console.log(`${this.logPrefix} Stopped watching ${this.config.channel}`);
  }

  /**
   * Resolve chatroom ID from channel name
   */
  private async resolveChatroomId(): Promise<void> {
    // If channel is already a number, use it as chatroom ID
    const parsedId = parseInt(this.config.channel);

    if (!isNaN(parsedId) && parsedId > 0) {
      this.chatroomId = parsedId;
      return;
    }

    // Otherwise, fetch chatroom info from API
    try {
      const response = await fetch(`https://kick.com/api/v2/channels/${this.config.channel}/chatroom`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://kick.com/',
          'Origin': 'https://kick.com'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { id: number };

      if (data?.id) {
        this.chatroomId = data.id;
      } else {
        throw new Error('Chatroom ID not found in API response');
      }
    } catch (error) {
      console.error(`${this.logPrefix} Error resolving chatroom ID:`, error);
      throw error;
    }
  }

  /**
   * Connect to Pusher WebSocket
   */
  private async connectWebSocket(): Promise<void> {
    if (this.isStopping || !this.shouldReconnect) {
      return;
    }

    // Clean up existing connection
    this.stopPingInterval();

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
      console.log(`${this.logPrefix} Connecting to Pusher WebSocket...`);
      this.ws = new WebSocket(this.pusherUrl);

      this.ws.on('open', () => {
        console.log(`${this.logPrefix} Connected to Pusher WebSocket`);
        this.reconnectAttempts = 0;
        this.subscribeToChannel();
        this.startPingInterval();
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

        this.stopPingInterval();
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
   * Subscribe to the chatroom channel
   */
  private subscribeToChannel(): void {
    if (!this.ws || !this.chatroomId) {
      return;
    }

    const channelName = `chatrooms.${this.chatroomId}.v2`;

    const subscribeMessage: PusherSubscribeMessage = {
      event: 'pusher:subscribe',
      data: {
        auth: '',
        channel: channelName
      }
    };

    console.log(`${this.logPrefix} Subscribing to channel: ${channelName}`);

    this.ws.send(JSON.stringify(subscribeMessage));
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(data: Buffer): void {
    try {
      const
        messageStr = data.toString('utf-8'),
        message = JSON.parse(messageStr) as PusherMessage;

      // Handle Pusher connection events
      if (message.event === 'pusher:connection_established') {
        console.log(`${this.logPrefix} Pusher connection established`);
        this.setActive(true);
        return;
      }

      if (message.event === 'pusher:subscription_succeeded') {
        console.log(`${this.logPrefix} Successfully subscribed to channel`);
        this.setActive(true);
        return;
      }

      // Handle chat message events
      if (message.event === 'App\\Events\\ChatMessageEvent') {
        try {
          const chatData = JSON.parse(message.data) as KickChatMessageEvent;
          this.processChatMessage(chatData);
        } catch (error) {
          console.error(`${this.logPrefix} Error parsing chat message:`, error);
        }
        return;
      }

      // Log other events for debugging
      if (message.event && !message.event.startsWith('pusher:')) {
        // console.log(`${this.logPrefix} Received event: ${message.event}`);
      }

    } catch (error) {
      console.error(`${this.logPrefix} Error handling WebSocket message:`, error);
    }
  }

  /**
   * Parse emote patterns in message content
   * Returns a map of emote patterns to their image URLs
   */
  private parseEmotes(content: string): Record<string, string> {
    const emotesMap: Record<string, string> = {};

    // Pattern: [emote:ID:name]
    // Map to: https://files.kick.com/emotes/ID/fullsize
    const emoteRegex = /\[emote:(\d+):[^\]]+\]/g;
    let match;

    while ((match = emoteRegex.exec(content)) !== null) {
      const fullEmote = match[0]; // The full [emote:ID:name] string
      const emoteId = match[1]; // The emote ID

      if (!emotesMap[fullEmote]) {
        emotesMap[fullEmote] = `https://files.kick.com/emotes/${emoteId}/fullsize`;
      }
    }

    return emotesMap;
  }

  /**
   * Process chat message from Pusher event
   */
  private processChatMessage(data: KickChatMessageEvent): void {
    const emotesMap = this.parseEmotes(data.content);

    const messageId = `kick-${data.id}`;

    const chatMessage: ChatMessage = {
      id: data.id,
      platform: this.platform,
      channel: this.config.channel,
      username: data.sender.username,
      message: data.content,
      emotesMap: Object.keys(emotesMap).length > 0 ? emotesMap : undefined,
      timestamp: new Date(data.created_at).getTime(),
      color: data.sender.identity?.color || undefined,
      badges: data.sender.identity?.badges?.map(badge => badge.type) || [],
      metadata: {
        userId: data.sender.id,
        chatroomId: data.chatroom_id,
        slug: data.sender.slug,
        badges: data.sender.identity?.badges || [],
        messageRef: data.metadata?.message_ref,
      },
    };

    this.emit('messageUpdated', chatMessage);
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPingInterval(): void {
    this.stopPingInterval(); // Clear any existing ping timer

    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.stopPingInterval();
        return;
      }

      try {
        const pingMessage = { event: 'pusher:ping', data: {} };
        this.ws.send(JSON.stringify(pingMessage));
      } catch (error) {
        console.error(`${this.logPrefix} Error sending ping:`, error);
        this.stopPingInterval();
      }
    }, this.pingInterval);
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
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
