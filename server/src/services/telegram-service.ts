import TelegramBot, { Message } from 'node-telegram-bot-api';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import chalk from 'chalk';

import type { ChatMessage, Platform, TelegramServiceConfig } from '@shared/shared-types.js';
import type { PlatformService, PlatformWithConfig, PlatformServiceEvents, WebhookHandler } from '@/types.js';

type TelegramServiceOptions = {
  webhookUrl: string;
  registerHandler: (path: string, handler: WebhookHandler) => void;
  unregisterHandler: (path: string) => void;
}

/**
 * Service for watching Telegram group messages
 */
export class TelegramService extends EventEmitter<PlatformServiceEvents> implements PlatformService {
  public readonly platform: Platform;
  private active: boolean = false;
  private readonly config: TelegramServiceConfig;
  private logPrefix: string;
  private webhookUrl: string;
  private webhookPath: string;
  private registerHandler: (path: string, handler: WebhookHandler) => void;
  private unregisterHandler: (path: string) => void;

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
    this.webhookPath = `/webhook/telegram/${randomUUID()}`;
    this.registerHandler = options.registerHandler;
    this.unregisterHandler = options.unregisterHandler;

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
      // Create bot instance without polling
      this.bot = new TelegramBot(this.config.botToken, { polling: false });

      // Register webhook handler with main server
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

      // Set webhook with certificate path (for Telegram to verify SSL)
      const fullWebhookUrl = `${this.webhookUrl}${this.webhookPath}`;

      await this.bot.setWebHook(fullWebhookUrl, {
        certificate: this.config.certificatePath
      });

      this.setupEventHandlers();
      this.setActive(true);

      console.log(`${this.logPrefix} Webhook listening at ${fullWebhookUrl}`);
    } catch (error) {
      console.error(`${this.logPrefix} Error setting up webhook:`, error);
      this.setActive(false);
      throw error;
    }
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

    this.bot.on('webhook_error', (error) => {
      console.error(`${this.logPrefix} Webhook error:`, error);
    });
  }

  private processMessage(msg: Message, isEdit: boolean = false): ChatMessage | null {
    // Only process messages with text or caption
    if (!msg.text && !msg.caption) {
      return null;
    }

    const isCaption = !msg.text && !!msg.caption;

    const caption = isCaption ? `🖼️  ${msg.caption}` : undefined;

    const messageText = caption || msg.text || '';

    // console.log(`${this.logPrefix} Message`, msg);

    // const emotesMap = this.parseEmotes(msg);

    const chatMessage: ChatMessage = {
      id: `telegram-${msg.message_id}`,
      platform: this.platform,
      channel: String(this.config.chatId),
      username: msg.from?.username || msg.from?.first_name || 'Unknown',
      message: messageText,
      timestamp: msg.date * 1000,
      isModerator: false, // Telegram doesn't have a simple moderator flag
      isEdited: isEdit,
      editDate: msg.edit_date ? msg.edit_date * 1000 : undefined,
      metadata: {
        messageId: msg.message_id,
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
      // Unregister webhook handler
      this.unregisterHandler(this.webhookPath);

      // Delete webhook
      if (this.bot) {
        await this.bot.deleteWebHook();
        this.bot = null;
      }

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

