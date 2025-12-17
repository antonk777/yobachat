import chalk from 'chalk';

import type {
  ChatMessage,
  ChatMessageDelete,
  ChatMessageUpdate,
  ChatSettings,
  KickServiceConfig,
  GoodgameServiceConfig,
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
  PlatformConfig,
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
import { GoodgameService } from '@/services/goodgame-service.js';
import { SettingsService } from '@/services/settings-service.js';
import { DeletedMessagesService } from '@/services/deleted-messages-service.js';
import { BetterTTVService } from '@/services/betterttv-service.js';
import { WebhookService } from '@/services/webhook-service.js';
import { WebSocketService } from '@/services/websocket-service.js';
import { WebAPIService } from '@/services/webapi-service.js';

import { kWSMessageType } from '@shared/shared-types.js';

import {
  kHiddenBadgesFilter,
  kServerConfig
} from '@/config';
import {
  validatePartialChatSettings
} from '@/validation.js';


class ChatServer {
  public logPrefix = chalk.yellow('[ChatServer]');

  private websocketService: WebSocketService;
  private platforms: Map<string, PlatformWithService> = new Map();

  private readonly config: ServerConfig;

  private settings = new SettingsService();
  private deletedMessages = new DeletedMessagesService();
  private betterttvService: BetterTTVService | null = null;
  private webhookService: WebhookService;
  private webApiService: WebAPIService;

  private _handleWSConnection = this.handleWSConnection.bind(this);
  private _handleWSMessage = this.handleWSMessage.bind(this);
  private _handleWSError = this.handleWSError.bind(this);

  constructor(config: ServerConfig) {
    this.config = config;
    this.webhookService = new WebhookService(config.webhookPort);
    this.websocketService = new WebSocketService(config);
    this.webApiService = new WebAPIService();

    // Set up WebSocket event listeners
    this.websocketService
      .on('connection', this._handleWSConnection)
      .on('message', this._handleWSMessage)
      .on('error', this._handleWSError);
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

    // Start web API server
    await this.webApiService.start();

    this.initializePlatforms(this.config.platforms);
    await this.startAll();
    this.setupGracefulShutdown();

    if (this.config.consoleMode) {
      console.log(`${this.logPrefix} Running in console-only mode`);
    } else {
      if (this.config.enableConsoleOutput) {
        console.log(`${this.logPrefix} Running in console-output mode`);
      }

      // Start WebSocket server
      await this.websocketService.start();
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
    const timestamp = chalk.gray(new Date(message.timestamp).toLocaleTimeString('ru-RU'));

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

    const editedIndicator = message.isEdited ? ' ✏️': '';

    const modIndicator = message.isModerator ? ' ⚔️' : '';

    console.log(`${platformBadge} ${timestamp} ${username}${modIndicator}:${editedIndicator} ${message.message}`);

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
    if (!this.websocketService) {
      return;
    }

    // Check if message was deleted
    if (this.deletedMessages.has(message.id)) {
      return;
    }

    const messageData: ChatMessageUpdate = {
      message
    };

    this.websocketService.broadcast(kWSMessageType.messageUpdate, messageData);
  }

  /**
   * Broadcast chat message delete to all connected WebSocket clients
   */
  private broadcastChatMessageDeletion(): void {
    if (this.config.consoleMode || !this.websocketService) {
      return;
    }

    const allDeletedIds = this.deletedMessages.getAll();

    this.websocketService.broadcast(kWSMessageType.messageUpdateDeletedIds, {
      ids: allDeletedIds
    });
  }

  /**
   * Broadcast clear all messages to all connected WebSocket clients
   */
  private broadcastClearAllMessages(): void {
    if (this.config.consoleMode || !this.websocketService) {
      return;
    }

    this.websocketService.broadcast(kWSMessageType.messageClearAll, {});
  }

  /**
   * Broadcast chat settings to all connected WebSocket clients
   */
  private broadcastChatSettings(): void {
    if (this.config.consoleMode || !this.websocketService) {
      return;
    }

    const settings = this.settings.getChatSettings();

    this.websocketService.broadcast(kWSMessageType.chatSettings, settings);
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
      // const validatedMessage = validateChatMessage(message);
      // if (!validatedMessage) {
      //   console.warn(`${this.logPrefix} Invalid message received from ${platform.name}, skipping`);
      //   return;
      // }

      let processedMessage = this.processMessage(message);

      processedMessage = this.enrichWithBetterTTV(processedMessage);

      if (this.config.consoleMode || this.config.enableConsoleOutput) {
        this.outputToConsole(processedMessage, platform);
      }

      if (!this.config.consoleMode) {
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
    platforms.forEach(platform => this.initializePlatform(platform));
  }

  private initializePlatform(platform: PlatformWithConfig<PlatformConfig>): void {
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
        const telegramConfig = platform.config as TelegramServiceConfig;
        const telegramMode = telegramConfig.mode;

        // Only provide webhook options if mode is 'webhook' or undefined (auto-detect)
        const telegramOptions: {
          webhookUrl?: string;
          registerHandler?: (path: string, handler: WebhookHandler) => void;
          unregisterHandler?: (path: string) => void;
        } = {};

        if (telegramMode !== 'polling') {
          // Construct webhook URL from server config (API host + webhook path)
          telegramOptions.webhookUrl = `https://${this.config.sharedConfig.apiHost}${this.config.sharedConfig.basePath}${this.config.webhookPath}`;
          telegramOptions.registerHandler = (path, handler) => this.registerWebhookHandler(path, handler);
          telegramOptions.unregisterHandler = (path) => this.unregisterWebhookHandler(path);
        }

        service = new TelegramService(
          platform as PlatformWithConfig<TelegramServiceConfig>,
          telegramOptions
        );
        break;
      case 'vkvideo':
        service = new VKVideoService(platform as PlatformWithConfig<VKVideoServiceConfig>);
        break;
      case 'kick':
        service = new KickService(platform as PlatformWithConfig<KickServiceConfig>);
        break;
      case 'goodgame':
        service = new GoodgameService(platform as PlatformWithConfig<GoodgameServiceConfig>);
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
  }

  /**
   * Handle a new WebSocket connection
   */
  private handleWSConnection(clientId: string): void {
    // Send welcome message and initial data
    this.websocketService.send(clientId, kWSMessageType.serverStatus, {
      connected: true,
      message: 'Hello from server!'
    });

    // Send initial data to admin clients
    this.sendPlatformsStatus(clientId);
    this.sendChatSettings(clientId);
    this.sendDeletedMessageIds(clientId);
  }

  /**
   * Handle incoming WebSocket messages (already decoded and validated)
   */
  private async handleWSMessage(clientId: string, message: WSMessage): Promise<void> {
    switch (message.type) {
      case kWSMessageType.adminDeleteMessage:
        await this.handleAdminDeleteMessage(clientId, message);
        break;

      case kWSMessageType.adminUpdateSettings:
        await this.handleAdminUpdateSettings(clientId, message);
        break;

      case kWSMessageType.adminClearAllMessages:
        this.broadcastClearAllMessages();
        console.log(`${this.logPrefix} Admin cleared all messages`);
        break;

      case kWSMessageType.adminRefreshBetterTTV:
        this.updateBetterTTVEmotes(clientId);
        break;
    }
  }

  /**
   * Handle WebSocket errors
   */
  private handleWSError(clientId: string, error: string): void {
    this.sendServerMessage(clientId, error);
  }

  /**
   * Send server status message to a specific client
   */
  private sendServerMessage(clientId: string, message: string): void {
    this.websocketService.send(clientId, kWSMessageType.serverStatus, {
      connected: true,
      message
    });
  }

  /**
   * Send platform status to a client
   */
  private sendPlatformsStatus(clientId: string): void {
    const platformsStatus: PlatformWithStatus[] = Array.from(this.platforms.values())
      .map(platform => ({
        id: platform.id,
        name: platform.name,
        color: platform.color,
        abbr: platform.abbr,
        active: platform.service?.isActive() ?? false
      }));

    this.websocketService.send(clientId, kWSMessageType.adminPlatformsStatus, {
      platforms: platformsStatus
    });
  }

  /**
   * Send current chat settings to a client (includes bad words)
   */
  private sendChatSettings(clientId: string): void {
    const settings = this.settings.getChatSettings();

    this.websocketService.send(clientId, kWSMessageType.chatSettings, settings);
  }

  /**
   * Send deleted message IDs to a client
   */
  private sendDeletedMessageIds(clientId: string): void {
    const deletedIds = this.deletedMessages.getAll();

    this.websocketService.send(clientId, kWSMessageType.messageUpdateDeletedIds, {
      ids: deletedIds
    });
  }

  /**
   * Handle admin delete message command
   */
  private async handleAdminDeleteMessage(clientId: string, message: WSAdminDeleteMessage): Promise<void> {
    if (message.type !== kWSMessageType.adminDeleteMessage) {
      return;
    }

    const { data } = message;

    if (data.ids.length === 0) {
      this.sendServerMessage(clientId, 'Invalid message: missing message IDs');
      return;
    }

    // Validate and sanitize message IDs
    try {
      await this.deletedMessages.add(data.ids);

      // Broadcast deletion to all clients (including the admin panel that requested it)
      this.broadcastChatMessageDeletion();

      console.log(`${this.logPrefix} Admin deleted messages: ${data.ids.join(', ')}`);
    } catch (error) {
      this.sendServerMessage(clientId, 'Invalid message IDs format');
      console.error(`${this.logPrefix} Failed to delete messages:`, error);
    }
  }

  /**
   * Handle admin update settings command
   */
  private async handleAdminUpdateSettings(clientId: string, message: WSMessage): Promise<void> {
    if (message.type !== kWSMessageType.adminUpdateSettings) {
      return;
    }

    const data = message.data;

    // Validate and sanitize chat settings
    const validatedSettings = validatePartialChatSettings(data);

    if (!validatedSettings) {
      this.sendServerMessage(clientId, 'Invalid chat settings: validation failed');
      return;
    }

    try {
      await this.settings.updateChatSettings(validatedSettings);
      this.broadcastChatSettings();

      console.log(`${this.logPrefix} Admin updated chat settings`);
    } catch (error) {
      this.sendServerMessage(clientId, 'Failed to update chat settings');
      console.error(`${this.logPrefix} Failed to update chat settings:`, error);
    }
  }

  private async updateBetterTTVEmotes(clientId: string): Promise<void> {
    if (!this.betterttvService) {
      this.sendServerMessage(clientId, 'BetterTTV service not initialized');
      return;
    }

    try {
      await this.betterttvService.update();
      this.sendServerMessage(clientId, 'BetterTTV emotes refreshed');
    } catch (error) {
      console.error(`${this.logPrefix} Failed to refresh BetterTTV emotes:`, error);
      this.sendServerMessage(clientId, 'Failed to refresh BetterTTV emotes');
    }
  }


  /**
   * Broadcast platform status update to all admin clients
   */
  private broadcastPlatformStatusUpdate(platform: Platform, active: boolean): void {
    if (this.config.consoleMode || !this.websocketService) {
      return;
    }

    this.websocketService.broadcast(kWSMessageType.adminPlatformStatusUpdate, {
      platform: {
        ...platform,
        active
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

    this.websocketService.off('connection', this._handleWSConnection);
    this.websocketService.off('message', this._handleWSMessage);
    this.websocketService.off('error', this._handleWSError);

    await this.websocketService.stop();
    await this.stopAll();

    await new Promise(resolve => setTimeout(resolve, 1000));

    await this.webhookService.stop();
    await this.webApiService.stop();

    console.log(`${this.logPrefix} shutdown finished`);

    process.exit(0);
  }
}

// Initialize and start the server
const chatServer = new ChatServer(kServerConfig);

chatServer.start().catch(error => {
  console.error(`${chatServer.logPrefix} Error starting server:`, error);
  process.exit(1);
});

// Send ready event to PM2
// process.send?.('ready');