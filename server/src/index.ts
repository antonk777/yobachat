import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import chalk from 'chalk';

import type {
  ChatMessage,
  ChatMessageDelete,
  ChatMessageUpdate,
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
import { MessageHistoryService } from '@/services/message-history-service.js';
import { WebhookService } from '@/services/webhook-service.js';
import { WebSocketService } from '@/services/websocket-service.js';
import { WebAPIService } from '@/services/webapi-service.js';
import { AuthService } from '@/services/auth-service.js';

import { kWSMessageType } from '@shared/shared-types.js';

import {
  kHiddenBadgesFilter,
  kServerConfig
} from '@/config';
import {
  validatePartialChatSettings
} from '@/validation.js';
import { kBatchDelayMS } from '@shared/shared-constants';
import { getApiOrigin, joinSharedPath } from '@shared/shared-urls.js';

export class ChatServer {
  public logPrefix = chalk.yellow('[ChatServer]');

  private websocketService: WebSocketService;
  private platforms: Map<string, PlatformWithService> = new Map();

  private readonly config: ServerConfig;

  private settings = new SettingsService();
  private deletedMessages = new DeletedMessagesService();
  private messageHistory = new MessageHistoryService();
  private webhookService: WebhookService;
  private webApiService: WebAPIService;
  private readonly authService: AuthService;

  // Message batching
  private messageBatch: ChatMessage[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;

  // WS event handlers
  private _handleWSConnection = this.handleWSConnection.bind(this);
  private _handleWSMessage = this.handleWSMessage.bind(this);
  private _handleWSError = this.handleWSError.bind(this);

  constructor(config: ServerConfig) {
    this.config = config;
    this.authService = new AuthService(config);
    this.webhookService = new WebhookService(config.webhookPort);
    this.websocketService = new WebSocketService(config, this.authService);
    this.webApiService = new WebAPIService(this.authService);

    // Set up WebSocket event listeners
    this.websocketService
      .on('connection', this._handleWSConnection)
      .on('message', this._handleWSMessage)
      .on('error', this._handleWSError);
  }

  async start(options?: { registerSignalHandlers?: boolean }): Promise<void> {
    // Initialize services (load from disk)
    await Promise.all([
      this.settings.init(),
      this.deletedMessages.init(),
      this.messageHistory.init()
    ]);

    // Start internal listeners before the public HTTP gateway (static + proxies)
    await this.webhookService.start();

    if (this.config.consoleMode) {
      console.log(`${this.logPrefix} Running in console-only mode`);
    } else {
      if (this.config.enableConsoleOutput) {
        console.log(`${this.logPrefix} Running in console-output mode`);
      }

      await this.websocketService.start();
    }

    // Public HTTP: API + static client + WS/webhook proxies
    await this.webApiService.start();

    this.initializePlatforms(this.config.platforms);
    await this.startAll();

    if (options?.registerSignalHandlers !== false) {
      this.setupGracefulShutdown();
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
   * Messages are batched and sent every kBatchDelayMS
   */
  private broadcastChatMessage(message: ChatMessage, platform: Platform): void {
    if (!this.websocketService) {
      return;
    }

    // Check if message was deleted
    if (this.deletedMessages.has(message.id)) {
      return;
    }

    // Add message to batch
    this.messageBatch.push(message);

    // Clear existing timeout if any
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }

    // Set new timeout to send batch after kBatchDelayMS
    this.batchTimeout = setTimeout(() => {
      this.flushMessageBatch();
    }, kBatchDelayMS);
  }

  /**
   * Flush the current message batch and send it to all clients
   */
  private flushMessageBatch(): void {
    if (this.messageBatch.length === 0) {
      return;
    }

    // Filter out deleted messages
    const validMessages = this.messageBatch.filter(
      msg => !this.deletedMessages.has(msg.id)
    );

    if (validMessages.length === 0) {
      this.messageBatch = [];
      this.batchTimeout = null;
      return;
    }

    // Add messages to history
    this.messageHistory.add(validMessages);

    const messageData: ChatMessageUpdate = {
      messages: validMessages
    };

    this.websocketService.broadcast(kWSMessageType.messageUpdate, messageData);

    // Clear batch
    this.messageBatch = [];
    this.batchTimeout = null;
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
    this.messageHistory.clear();

    if (this.config.consoleMode || !this.websocketService) {
      return;
    }

    this.websocketService.broadcast(kWSMessageType.messageClearAll, {});
  }

  /**
   * Broadcast widget refresh event to all connected WebSocket clients
   */
  private broadcastWidgetRefresh(): void {
    if (this.config.consoleMode || !this.websocketService) {
      return;
    }

    this.websocketService.broadcast(kWSMessageType.widgetRefresh, {});
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
      message.badges = message.badges.filter(badge =>
        !kHiddenBadgesFilter.some(hiddenBadge => badge.toLowerCase().includes(hiddenBadge.toLowerCase()))
      );
    }

    // Filter badge images
    if (message.badgeImages && Object.keys(message.badgeImages).length > 0) {
      const entries = Object.entries(message.badgeImages ?? {})
        .filter(([badgeName]) =>
          !kHiddenBadgesFilter.some(hiddenBadge => badgeName.toLowerCase().includes(hiddenBadge.toLowerCase()))
        );

      message.badgeImages = Object.fromEntries(entries);
    }

    return message;
  }

  /**
   * Apply filters and dispatch the message to the appropriate sinks
   */
  private handleIncomingMessage(platform: PlatformWithConfig, message: ChatMessage): void {
    try {
      const processedMessage = this.processMessage(message);

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
      case 'twitch': {
        const twPlatform = platform as PlatformWithConfig<TwitchServiceConfig>;
        service = new TwitchService(twPlatform);
        break;
      }
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
          telegramOptions.webhookUrl = `${getApiOrigin(this.config.sharedConfig)}${joinSharedPath(this.config.sharedConfig, this.config.webhookPath)}`;
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
    this.websocketService.send(clientId, kWSMessageType.adminServerStatus, {
      connected: true,
      message: 'Hello from server!'
    });

    this.sendChatSettings(clientId);
    this.sendDeletedMessageIds(clientId);

    // Send message history to the new client
    this.sendMessageHistory(clientId);

    // Only send admin data to authenticated users
    if (this.isClientAuthenticated(clientId)) {
      this.sendPlatformsStatus(clientId);
    }
  }

  /**
   * Check if a client is authenticated for admin operations
   */
  private isClientAuthenticated(clientId: string): boolean {
    const user = this.websocketService.getAuthenticatedUser(clientId);

    if (!user) {
      return false;
    }

    return this.authService.isUsernameAllowed(user.username);
  }

  /**
   * Handle incoming WebSocket messages (already decoded and validated)
   */
  private async handleWSMessage(clientId: string, message: WSMessage): Promise<void> {
    if (!this.isClientAuthenticated(clientId)) {
      console.warn(`${this.logPrefix} Unauthorized admin message attempt from ${clientId}`);
      return;
    }

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

      case kWSMessageType.adminRefreshWidget:
        this.broadcastWidgetRefresh();
        console.log(`${this.logPrefix} Admin triggered widget refresh`);
        break;

      case kWSMessageType.adminRestartServer:
        await this.handleAdminRestartServer(clientId);
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
    if (!this.isClientAuthenticated(clientId)) {
      return;
    }

    this.websocketService.send(clientId, kWSMessageType.adminServerStatus, {
      connected: true,
      message
    });
  }

  /**
   * Send platform status to a client
   */
  private sendPlatformsStatus(clientId: string): void {
    if (!this.isClientAuthenticated(clientId)) {
      return;
    }

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
   * Send message history to a client (last 60 messages)
   */
  private sendMessageHistory(clientId: string): void {
    // Filter out deleted messages
    const deletedIds = this.deletedMessages.getAll();
    const validMessages = this.messageHistory.getFiltered(deletedIds);

    if (validMessages.length === 0) {
      return;
    }

    const messageData: ChatMessageUpdate = {
      messages: validMessages
    };

    this.websocketService.send(clientId, kWSMessageType.messageUpdate, messageData);
  }

  /**
   * Handle admin delete message command
   */
  private async handleAdminDeleteMessage(clientId: string, message: WSAdminDeleteMessage): Promise<void> {
    if (message.type !== kWSMessageType.adminDeleteMessage || !this.isClientAuthenticated(clientId)) {
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

      // Remove deleted messages from history
      this.messageHistory.removeByIds(data.ids);

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
    if (message.type !== kWSMessageType.adminUpdateSettings || !this.isClientAuthenticated(clientId)) {
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

  /**
   * Handle admin restart: exit so the process manager (Docker) restarts the container.
   */
  private async handleAdminRestartServer(clientId: string): Promise<void> {
    this.sendServerMessage(clientId, 'Restarting server...');
    console.log(`${this.logPrefix} Admin triggered server restart — exiting process`);

    // Allow the WS message to flush, then exit. Docker `restart: unless-stopped` brings us back.
    setTimeout(() => {
      void this.shutdown(true);
    }, 250);
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
    }, this.isClientAuthenticated.bind(this));
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
  public async shutdown(exitProcess = true): Promise<void> {
    console.log(`${this.logPrefix} Shutting down...`);

    // Flush any pending message batches
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.flushMessageBatch();
    }

    // Save message history immediately
    await this.messageHistory.saveImmediate();

    this.websocketService.off('connection', this._handleWSConnection);
    this.websocketService.off('message', this._handleWSMessage);
    this.websocketService.off('error', this._handleWSError);

    await this.websocketService.stop();
    await this.stopAll();

    await new Promise(resolve => setTimeout(resolve, 1000));

    await this.webhookService.stop();
    await this.webApiService.stop();

    console.log(`${this.logPrefix} shutdown finished`);

    if (exitProcess) {
      process.exit(0);
    }
  }
}

export async function startChatServer(options?: { registerSignalHandlers?: boolean }): Promise<ChatServer> {
  const chatServer = new ChatServer(kServerConfig);
  await chatServer.start(options);
  return chatServer;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  startChatServer().catch(error => {
    console.error(`${chalk.yellow('[ChatServer]')} Error starting server:`, error);
    process.exit(1);
  });
}
