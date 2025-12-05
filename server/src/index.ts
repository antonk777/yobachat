import { WebSocketServer, WebSocket } from 'ws';
import chalk from 'chalk';

import type {
  ChatMessage,
  ChatMessageDelete,
  ChatMessageUpdate,
  ChatSettings,
  KickServiceConfig,
  Platform,
  PlatformWithStatus,
  TelegramServiceConfig,
  TwitchServiceConfig,
  VKVideoServiceConfig,
  WSAdminDeleteMessage,
  WSMessage,
  YouTubeServiceConfig
} from '@shared/shared-types.js';
import type {
  PlatformService,
  PlatformWithConfig,
  PlatformWithService,
  ServerConfig,
  WebhookHandler
} from '@/types.js';

import { TwitchService } from '@/services/twitch-service.js';
import { YouTubeService } from '@/services/youtube-service.js';
import { TelegramService } from '@/services/telegram-service.js';
import { VKVideoService } from '@/services/vkvideo-service.js';
import { KickService } from '@/services/kick-service.js';
import { SettingsService } from '@/services/settings-service.js';
import { DeletedMessagesService } from '@/services/deleted-messages-service.js';
import { BetterTTVService } from '@/services/betterttv-service.js';
import { WebhookService } from '@/services/webhook-service.js';

import { encodeWSMessage, decodeWSMessage } from '@shared/shared-messenger.js';
import { kWSMessageType } from '@shared/shared-types.js';

import {
  kHiddenBadgesFilter,
  kServerConfig
} from '@/config';
import {
  validateWSMessage,
  validateChatMessage,
  validatePartialChatSettings
} from '@/validation.js';


class ChatServer {
  public logPrefix = chalk.yellow('[ChatServer]');

  private wss: WebSocketServer | null = null;
  private platforms: Map<string, PlatformWithService> = new Map();

  private readonly config: ServerConfig;

  private settings = new SettingsService();
  private deletedMessages = new DeletedMessagesService();
  private betterttvService: BetterTTVService | null = null;
  private webhookService: WebhookService;

  constructor(config: ServerConfig) {
    this.config = config;
    this.webhookService = new WebhookService(config.webhookPort);
  }

  async start(): Promise<void> {
    // Initialize BetterTTV service with config (already validated when loading from JSON)
    this.betterttvService = new BetterTTVService(this.config.betterttv);

    // Initialize services (load from disk)
    await Promise.all([
      this.settings.init(),
      this.deletedMessages.init()
    ]);

    await this.betterttvService.update();

    // Start webhook server (must be before platform initialization)
    await this.webhookService.start();

    this.initializePlatforms(this.config.platforms);
    await this.startAll();
    this.setupGracefulShutdown();

    if (this.config.consoleMode) {
      console.log(`${this.logPrefix} Running in console-only mode`);
    } else {
      if (this.config.enableConsoleOutput) {
        console.log(`${this.logPrefix} Running in console-output mode`);
      }

      const port = this.config.wsPort;

      this.wss = new WebSocketServer({ port });

      this.setupWsConnectionHandlers();

      console.log(`${this.logPrefix} WebSocket server listening on port ${port}`);
    }
  }

  /**
   * Register a webhook handler
   */
  private registerWebhookHandler(path: string, handler: WebhookHandler): void {
    this.webhookService.registerHandler(path, handler);
  }

  /**
   * Unregister a webhook handler
   */
  private unregisterWebhookHandler(path: string): void {
    this.webhookService.unregisterHandler(path);
  }

  /**
   * Output chat message to console
   */
  private outputToConsole(message: ChatMessage, platform: Platform): void {
    const timestamp = chalk.gray(new Date(message.timestamp).toLocaleTimeString());

    const platformColor = chalk.hex(platform.color);

    const platformBadge = platformColor(`[${platform.abbr}]`);

    // Badges
    let badges = ''

    if (message.badges && message.badges.length > 0) {
      const badgesArray = message.badges.map(badge => chalk.gray(`[${badge}]`));

      badges = ` ${badgesArray.join('')}`;
    }

    // Username with color if available
    const username = message.color
      ? chalk.hex(message.color)(message.username)
      : chalk.white(message.username);

    const editedIndicator = message.isEdited ? chalk.gray(' ✏️') : '';

    console.log(`${timestamp} ${platformBadge} ${username}${badges}${editedIndicator}: ${message.message}`);

    if (message.emotesMap && Object.keys(message.emotesMap).length > 0) {
      console.log(`  Emotes: ${JSON.stringify(message.emotesMap)}`);
    }

    if (message.badgeImages && Object.keys(message.badgeImages).length > 0) {
      console.log(`  Badges: ${JSON.stringify(message.badgeImages)}`);
    }
  }

  /**
   * Output chat message delete to console
   */
  private outputToConsoleDelete(id: string | number, platform: Platform): void {
    if (!this.config.consoleMode && !this.config.enableConsoleOutput) {
      return;
    }

    const platformColor = chalk.hex(platform.color);

    const platformBadge = platformColor(`[${platform.abbr}]`);

    console.log(`${this.logPrefix} ${platformBadge} 🗑️ Message ${id} deleted`);
  }

  /**
   * Broadcast chat message to all connected WebSocket clients
   */
  private broadcastChatMessage(message: ChatMessage, platform: Platform): void {
    if (!this.wss) {
      return;
    }

    // Check if message was deleted
    if (this.deletedMessages.has(message.id)) {
      return;
    }

    const messageData: ChatMessageUpdate = {
      message
    };

    const messageJson = encodeWSMessage({
      type: kWSMessageType.messageUpdate,
      data: messageData
    });

    this.broadcastWSMessage(messageJson);
  }

  /**
   * Broadcast chat message delete to all connected WebSocket clients
   */
  private broadcastChatMessageDeletion(): void {
    if (this.config.consoleMode || !this.wss) {
      return;
    }

    const allDeletedIds = this.deletedMessages.getAll();

    const messageJSON = encodeWSMessage({
      type: kWSMessageType.messageUpdateDeletedIds,
      data: {
        ids: allDeletedIds
      }
    });

    this.broadcastWSMessage(messageJSON);
  }

  /**
   * Broadcast clear all messages to all connected WebSocket clients
   */
  private broadcastClearAllMessages(): void {
    if (this.config.consoleMode || !this.wss) {
      return;
    }

    const messageJSON = encodeWSMessage({
      type: kWSMessageType.messageClearAll,
      data: {}
    });

    this.broadcastWSMessage(messageJSON);
  }

  /**
   * Broadcast chat settings to all connected WebSocket clients
   */
  private broadcastChatSettings(): void {
    if (this.config.consoleMode || !this.wss) {
      return;
    }

    const settings = this.settings.getChatSettings();

    const messageJSON = encodeWSMessage({
      type: kWSMessageType.chatSettings,
      data: settings
    });

    this.broadcastWSMessage(messageJSON);
  }

  private broadcastWSMessage(messageJSON: string): void {
    if (this.config.consoleMode || !this.wss) {
      return;
    }

    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(messageJSON);
        } catch (error) {
          console.error(`${this.logPrefix} Failed to broadcast WebSocket message:`, error);
        }
      }
    });
  }

  private processMessage(message: ChatMessage): ChatMessage {
    // Skip if message was deleted
    if (this.deletedMessages.has(message.id)) {
      return message;
    }

    // Filter badges
    if (message.badges && message.badges.length > 0) {
      message.badges = message.badges.filter(badge => kHiddenBadgesFilter.includes(badge));
    }

    // Filter badge images
    if (message.badgeImages && Object.keys(message.badgeImages).length > 0) {
      const entries = Object.entries(message.badgeImages ?? {})
        .filter(([badgeName]) => kHiddenBadgesFilter.includes(badgeName));

      message.badgeImages = Object.fromEntries(entries);
    }

    return message;
  }

  /**
   * Apply filters, BetterTTV emotes, and dispatch the message to the appropriate sinks
   */
  private handleIncomingMessage(platform: PlatformWithConfig, message: ChatMessage): void {
    try {
      // Validate and sanitize the incoming message (always use fast validation)
      const validatedMessage = validateChatMessage(message);
      if (!validatedMessage) {
        console.warn(`${this.logPrefix} Invalid message received from ${platform.name}, skipping`);
        return;
      }

      let processedMessage = this.processMessage(validatedMessage);

      processedMessage = this.enrichWithBetterTTV(processedMessage);

      if (this.config.consoleMode || this.config.enableConsoleOutput) {
        this.outputToConsole(processedMessage, platform);
      }

      if (!this.config.enableConsoleOutput) {
        this.broadcastChatMessage(processedMessage, platform);
      }
    } catch (error) {
      console.error(`${this.logPrefix} Failed to handle message for ${platform.name}:`, error);
    }
  }

  /**
   * Merge BetterTTV and custom emotes into the message if configured
   */
  private enrichWithBetterTTV(message: ChatMessage): ChatMessage {
    if (!this.betterttvService) {
      return message;
    }
    try {
      return this.betterttvService.enhanceMessage(message);
    } catch (error) {
      console.warn(`${this.logPrefix} Failed to enrich BetterTTV emotes:`, error);
      return message;
    }
  }

  /**
   * Initialize sources from configuration (called on startup)
   */
  private initializePlatforms(platforms: PlatformWithConfig[]): void {
    platforms.forEach(platform => {
      let service: PlatformService;

      const platformOnly: Platform = {
        id: platform.id,
        name: platform.name,
        color: platform.color,
        abbr: platform.abbr
      }

      switch (platform.id) {
        case 'twitch':
          service = new TwitchService(platform as PlatformWithConfig<TwitchServiceConfig>);
          break;
        case 'youtube':
          service = new YouTubeService(platform as PlatformWithConfig<YouTubeServiceConfig>);
          break;
        case 'telegram':
          // Construct webhook URL from server config (API host + webhook path)
          const webhookUrl = `https://${this.config.sharedConfig.apiHost}${this.config.sharedConfig.basePath}${this.config.webhookPath}`;

          service = new TelegramService(
            platform as PlatformWithConfig<TelegramServiceConfig>,
            {
              webhookUrl,
              registerHandler: (path, handler) => this.registerWebhookHandler(path, handler),
              unregisterHandler: (path) => this.unregisterWebhookHandler(path)
            }
          );
          break;
        case 'vkvideo':
          service = new VKVideoService(platform as PlatformWithConfig<VKVideoServiceConfig>);
          break;
        case 'kick':
          service = new KickService(platform as PlatformWithConfig<KickServiceConfig>);
          break;
        default:
          throw new Error(`Unsupported platform: ${platform.id}`);
      }

      // Listen for message events from the service
      service.on('messageUpdated', (message: ChatMessage) => {
        this.handleIncomingMessage(platform, message);
      });

      // Message deleted by user in chat
      service.on('messageDeleted', (deleteEvent: ChatMessageDelete) => {
        this.outputToConsoleDelete(deleteEvent.id, platform);
        this.broadcastChatMessageDeletion();
      });

      service.on('status', (active: boolean) => {
        // Broadcast platform status change to admin clients
        this.broadcastPlatformStatusUpdate(platformOnly, active);
      });

      this.platforms.set(platform.name, { ...platform, service });
    });
  }

  /**
   * Set up WebSocket connection handlers
   */
  private setupWsConnectionHandlers(): void {
    if (!this.wss) {
      return;
    }

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleWSConnection(ws);
    });
  }

  /**
   * Handle a new WebSocket connection
   */
  private handleWSConnection(ws: WebSocket): void {
    console.log(`${this.logPrefix} WS Client connected`);

    ws.on('close', () => {
      console.log(`${this.logPrefix} WS Client disconnected`);
    });

    ws.on('error', error => {
      console.error(`${this.logPrefix} WebSocket error:`, error);
    });

    ws.on('message', async (data: Buffer) => {
      try {
        // decodeWSMessage now includes validation - returns null if invalid
        const message = decodeWSMessage(data.toString());

        if (!message) {
          this.sendServerMessage(ws, 'Invalid message format or structure');
          return;
        }

        // Optional: Additional deep validation with Zod for extra security
        // This is redundant but provides defense in depth
        const validatedMessage = validateWSMessage(message);

        if (!validatedMessage) {
          console.warn(`${this.logPrefix} Message passed basic validation but failed deep validation`);
          this.sendServerMessage(ws, 'Invalid message structure');
          return;
        }

        await this.handleWSAdminCommand(ws, validatedMessage);
      } catch (error) {
        console.error(`${this.logPrefix} Error handling WebSocket message:`, error);
        this.sendServerMessage(ws, 'Error processing message');
      }
    });

    // Send welcome message and initial data
    const connectionResponse = encodeWSMessage({
      type: kWSMessageType.serverStatus,
      data: {
        connected: true,
        message: 'Hello from server!'
      }
    });

    ws.send(connectionResponse);

    // Send initial data to admin clients
    this.sendPlatformsStatus(ws);
    this.sendChatSettings(ws);
    this.sendDeletedMessageIds(ws);
  }

  /**
   * Handle admin commands from WebSocket clients
   */
  private async handleWSAdminCommand(ws: WebSocket, message: WSMessage): Promise<void> {
    switch (message.type) {
      case kWSMessageType.adminDeleteMessage:
        await this.handleAdminDeleteMessage(ws, message);
        break;

      case kWSMessageType.adminUpdateSettings:
        await this.handleAdminUpdateSettings(ws, message);
        break;

      case kWSMessageType.adminClearAllMessages:
        this.broadcastClearAllMessages();
        console.log(`${this.logPrefix} Admin cleared all messages`);
        break;

      case kWSMessageType.adminRefreshBetterTTV:
        this.updateBetterTTVEmotes(ws);
        break;
    }
  }

  /**
   * Handle admin delete message command
   */
  private async handleAdminDeleteMessage(ws: WebSocket, message: WSAdminDeleteMessage): Promise<void> {
    if (message.type !== kWSMessageType.adminDeleteMessage) {
      return;
    }

    const data = message.data;

    if (!data || !data.ids || !Array.isArray(data.ids) || data.ids.length === 0) {
      this.sendServerMessage(ws, 'Invalid message: missing message IDs');
      return;
    }

    // Validate and sanitize message IDs
    try {
      await this.deletedMessages.add(data.ids);

      // Broadcast deletion to all clients (including the admin panel that requested it)
      this.broadcastChatMessageDeletion();

      console.log(`${this.logPrefix} Admin deleted messages: ${data.ids.join(', ')}`);
    } catch (error) {
      this.sendServerMessage(ws, 'Invalid message IDs format');
      console.error(`${this.logPrefix} Failed to delete messages:`, error);
    }
  }

  /**
   * Handle admin update settings command
   */
  private async handleAdminUpdateSettings(ws: WebSocket, message: WSMessage): Promise<void> {
    if (message.type !== kWSMessageType.adminUpdateSettings) {
      return;
    }

    const data = message.data as Partial<ChatSettings>;

    if (!data) {
      this.sendServerMessage(ws, 'Invalid chat settings: missing data');
      return;
    }

    // Validate and sanitize chat settings
    const validatedSettings = validatePartialChatSettings(data);

    if (!validatedSettings) {
      this.sendServerMessage(ws, 'Invalid chat settings: validation failed');
      return;
    }

    try {
      await this.settings.updateChatSettings(validatedSettings);
      this.broadcastChatSettings();

      console.log(`${this.logPrefix} Admin updated chat settings`);
    } catch (error) {
      this.sendServerMessage(ws, 'Failed to update chat settings');
      console.error(`${this.logPrefix} Failed to update chat settings:`, error);
    }
  }

  private async updateBetterTTVEmotes(ws: WebSocket): Promise<void> {
    if (!this.betterttvService) {
      this.sendServerMessage(ws, 'BetterTTV service not initialized');
      return;
    }
    try {
      await this.betterttvService.update();
      this.sendServerMessage(ws, 'BetterTTV emotes refreshed');
    } catch (error) {
      console.error(`${this.logPrefix} Failed to refresh BetterTTV emotes:`, error);
      this.sendServerMessage(ws, 'Failed to refresh BetterTTV emotes');
    }
  }

  private sendServerMessage(ws: WebSocket, message: string): void {
    const response = encodeWSMessage({
      type: kWSMessageType.serverStatus,
      data: {
        connected: true,
        message
      }
    });

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(response);
    }
  }

  /**
   * Send platform status to a client
   */
  private sendPlatformsStatus(ws: WebSocket): void {
    const platformsStatus: PlatformWithStatus[] = Array.from(this.platforms.values())
      .map(platform => ({
        id: platform.id,
        name: platform.name,
        color: platform.color,
        abbr: platform.abbr,
        active: platform.service?.isActive() ?? false
      }));

    const response = encodeWSMessage({
      type: kWSMessageType.adminPlatformsStatus,
      data: { platforms: platformsStatus }
    });

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(response);
    }
  }

  /**
   * Send current chat settings to a client (includes bad words)
   */
  private sendChatSettings(ws: WebSocket): void {
    const settings = this.settings.getChatSettings();

    const response = encodeWSMessage({
      type: kWSMessageType.chatSettings,
      data: settings
    });

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(response);
    }
  }

  /**
   * Send deleted message IDs to a client
   */
  private sendDeletedMessageIds(ws: WebSocket): void {
    const deletedIds = this.deletedMessages.getAll();

    const response = encodeWSMessage({
      type: kWSMessageType.messageUpdateDeletedIds,
      data: {
        ids: deletedIds
      }
    });

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(response);
    }
  }

  /**
   * Broadcast platform status update to all admin clients
   */
  private broadcastPlatformStatusUpdate(platform: Platform, active: boolean): void {
    if (this.config.consoleMode || !this.wss) {
      return;
    }

    const response = encodeWSMessage({
      type: kWSMessageType.adminPlatformStatusUpdate,
      data: {
        platform: {
          ...platform,
          active
        }
      }
    });

    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(response);
      }
    });
  }


  /**
   * Set up graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  /**
   * Start all sources
   */
  public async startAll(): Promise<void> {
    const platforms = Array.from(this.platforms.values());

    const promises = platforms.map(async (platform) => {
      if (!platform.service) {
        return;
      }

      try {
        await platform.service.start();
      } catch (error) {
        console.error(`${this.logPrefix} Error starting platform ${platform.name}:`, error);
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Stop all sources
   */
  public async stopAll(): Promise<void> {
    const platforms = Array.from(this.platforms.values());

    const promises = platforms.map(async (platform) => {
      if (!platform.service) {
        return;
      }

      try {
        await platform.service.stop();
      } catch (error) {
        console.error(`${this.logPrefix} Error stopping platform ${platform.name}:`, error);
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Gracefully shutdown the server
   */
  public async shutdown(): Promise<void> {
    console.log(`${this.logPrefix} Shutting down...`);

    const response = encodeWSMessage({
      type: kWSMessageType.serverStatus,
      data: { connected: true, message: 'Server is shutting down...' }
    });

    if (this.wss && this.wss.clients.size > 0) {
      this.wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(response);
        }
      });
    }

    await this.stopAll();

    await new Promise(resolve => setTimeout(resolve, 1000));

    await this.webhookService.stop();

    if (this.wss) {
      this.wss.close();
    }

    process.exit(0);
  }
}

// Initialize and start the server
const chatServer = new ChatServer(kServerConfig);

await chatServer.start().catch(error => {
  console.error(`${chatServer.logPrefix} Error starting server:`, error);
  process.exit(1);
});
