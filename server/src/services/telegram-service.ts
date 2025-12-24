import TelegramBot, { Message } from 'node-telegram-bot-api';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import chalk from 'chalk';

import type { ChatMessage, Platform, TelegramServiceConfig } from '@shared/shared-types.js';
import type { PlatformService, PlatformWithConfig, PlatformServiceEvents, WebhookHandler } from '@/types.js';

type TelegramServiceOptions = {
  webhookUrl?: string;
  registerHandler?: (path: string, handler: WebhookHandler) => void;
  unregisterHandler?: (path: string) => void;
}

/**
 * Service for watching Telegram group messages
 */
export class TelegramService extends EventEmitter<PlatformServiceEvents> implements PlatformService {
  public readonly platform: Platform;
  private active: boolean = false;
  private logPrefix: string;
  private readonly config: TelegramServiceConfig;
  private useWebhook: boolean = false;
  private webhookUrl?: string;
  private webhookPath: string;
  private registerHandler?: (path: string, handler: WebhookHandler) => void;
  private unregisterHandler?: (path: string) => void;

  private bot: TelegramBot | null = null;
  private messageIds: Set<number> = new Set();

  constructor(
    platformConfig: PlatformWithConfig<TelegramServiceConfig>,
    options: TelegramServiceOptions
  ) {
    super();

    this.platform = {
      id: platformConfig.id,
      name: platformConfig.name,
      color: platformConfig.color,
      abbr: platformConfig.abbr
    };

    this.config = platformConfig.config as TelegramServiceConfig;
    this.webhookUrl = options.webhookUrl;
    // webhookPath includes /webhook/ prefix to match what nginx forwards
    this.webhookPath = `/webhook/telegram/${randomUUID()}`;
    this.registerHandler = options.registerHandler;
    this.unregisterHandler = options.unregisterHandler;

    // Determine mode: use config.mode if specified, otherwise default to polling
    const configuredMode = this.config.mode;

    if (configuredMode === 'polling') {
      this.useWebhook = false;
    } else if (configuredMode === 'webhook') {
      this.useWebhook = true;
      if (!this.webhookUrl) {
        throw new Error('webhookUrl is required when mode is set to "webhook"');
      }
    }

    this.logPrefix = chalk.hex(this.platform.color)(`[${this.platform.abbr}]`);
  }

  protected emitMessage(message: ChatMessage): void {
    this.emit('messageUpdated', message);
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

    try {
      if (this.useWebhook) {
        await this.startWebhook();
      } else {
        await this.startPolling();
      }
    } catch (error) {
      console.error(`${this.logPrefix} Error starting service:`, error);
      this.setActive(false);
      throw error;
    }
  }

  /**
   * Start the bot in polling mode
   */
  private async startPolling(): Promise<void> {
    const pollingOptions: TelegramBot.PollingOptions = {
      interval: this.config.pollInterval ?? 1000,
      autoStart: true,
      params: {
        allowed_updates: ['message', 'edited_message']
      }
    };

    this.bot = new TelegramBot(this.config.botToken, { polling: pollingOptions });
    this.setupEventHandlers();
    this.setActive(true);
    console.log(`${this.logPrefix} Started polling for chat ${this.config.chatId} (interval: ${pollingOptions.interval}ms)`);
  }

  /**
   * Start the bot in webhook mode
   */
  private async startWebhook(): Promise<void> {
    this.validateWebhookRequirements();

    // Create bot instance without polling
    this.bot = new TelegramBot(this.config.botToken, { polling: false });

    // Register webhook handler with main server
    this.registerWebhookHandler();

    // Set webhook with certificate path (for Telegram to verify SSL)
    // webhookUrl already includes /webhook/, and webhookPath also starts with /webhook/
    // So we need to remove /webhook/ from webhookUrl to avoid duplication
    const baseUrl = this.webhookUrl?.replace(/\/webhook\/?$/, '') || '';
    const fullWebhookUrl = `${baseUrl}${this.webhookPath}`;

    await this.bot.setWebHook(fullWebhookUrl);

    this.setupEventHandlers();
    this.setActive(true);

    console.log(`${this.logPrefix} Webhook listening at ${fullWebhookUrl}`);
  }

  /**
   * Validate that all required fields are present for webhook mode
   */
  private validateWebhookRequirements(): void {
    if (!this.webhookUrl) {
      throw new Error('webhookUrl is required for webhook mode');
    }
    if (!this.registerHandler || !this.unregisterHandler) {
      throw new Error('registerHandler and unregisterHandler are required for webhook mode');
    }
  }

  /**
   * Register the webhook handler with the main server
   */
  private registerWebhookHandler(): void {
    if (!this.registerHandler) {
      return;
    }

    this.registerHandler(this.webhookPath, (req, res) => {
      try {
        const update = req.body;

        if (this.bot) {
          // Process the update through the bot
          this.bot.processUpdate(update);
        }
        res.status(200).json({ ok: true });
      } catch (error) {
        console.error(`${this.logPrefix} Error processing webhook update:`, error);
        res.status(500).json({ ok: false, error: 'Failed to process update' });
      }
    });
  }

  /**
   * Setup event handlers for the Telegram bot
   */
  private setupEventHandlers(): void {
    if (!this.bot) return;

    this.bot.on('message', (msg) => {
      // Only process messages from the configured chat
      if (String(msg.chat.id) !== String(this.config.chatId)) {
        return;
      }

      // Skip if we've already processed this message
      if (this.messageIds.has(msg.message_id)) {
        return;
      }

      this.messageIds.add(msg.message_id);

      const chatMessage = this.processMessage(msg);

      if (chatMessage) {
        this.emitMessage(chatMessage);
      }
    });

    // Handle edited messages (covers all types of edits: text, caption, media, etc.)
    this.bot.on('edited_message', (msg) => {
      // Only process messages from the configured chat
      if (String(msg.chat.id) !== String(this.config.chatId)) {
        return;
      }

      const chatMessage = this.processMessage(msg, true);

      if (chatMessage) {
        this.emitMessage(chatMessage);
      }
    });

    // Only register webhook_error handler in webhook mode
    if (this.useWebhook) {
      this.bot.on('webhook_error', (error) => {
        console.error(`${this.logPrefix} Webhook error:`, error);
      });
    }
  }

  private processMessage(msg: Message, isEdit: boolean = false): ChatMessage | null {
    // Only process messages with text or caption
    if (!msg.text && !msg.caption) {
      return null;
    }

    const isCaptionOnly = !msg.text && !!msg.caption;

    const caption = isCaptionOnly ? `🖼️  ${msg.caption}` : undefined;

    const messageText = caption || msg.text || '';

    const messageId = `telegram-${msg.message_id}`;

    const chatMessage: ChatMessage = {
      id: messageId,
      platform: this.platform,
      channel: String(this.config.chatId),
      username: msg.from?.first_name ?? msg.from?.username ?? '',
      message: messageText,
      timestamp: msg.date * 1000,
      isModerator: false, // Telegram doesn't have a simple moderator flag
      isEdited: isEdit,
      editDate: msg.edit_date ? msg.edit_date * 1000 : undefined,
      metadata: {
        userId: msg.from?.id,
        chatId: msg.chat.id,
        chatType: msg.chat.type,
        firstName: msg.from?.first_name,
        lastName: msg.from?.last_name,
      }
    };

    return chatMessage;
  }

  async stop(): Promise<void> {
    try {
      if (this.useWebhook) {
        // Unregister webhook handler
        if (this.unregisterHandler) {
          this.unregisterHandler(this.webhookPath);
        }

        // Delete webhook
        if (this.bot) {
          await this.bot.deleteWebHook();
        }
      } else {
        // Stop polling
        if (this.bot) {
          this.bot.stopPolling();
        }
      }

      this.bot = null;
      this.setActive(false);
      this.messageIds.clear();
      console.log(`${this.logPrefix} Stopped watching chat ${this.config.chatId}`);
    } catch (error) {
      console.error(`${this.logPrefix} Error stopping service:`, error);
      // Still mark as stopped even if stop fails
      this.bot = null;
      this.setActive(false);
    }
  }
}

