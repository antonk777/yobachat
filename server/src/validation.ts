import { z } from 'zod';
import chalk from 'chalk';

import type { ChatMessage, ChatSettings, Platform, WSMessage, TwitchServiceConfig, YouTubeServiceConfig, TelegramServiceConfig, VKVideoServiceConfig, KickServiceConfig, GoodgameServiceConfig, SharedConfig } from '@shared/shared-types.js';
import { kWSMessageType } from '@shared/shared-types.js';
import {
  ChatMessageSchema,
  EmoteAddSchema,
  EmoteDeleteSchema,
  EmoteRenameSchema,
  EmoteReviewSchema,
  SiteEmoteSchema,
  parseChatMessage,
} from 'yobachat-shared';
import type { AppConfigFile, ServerConfigFile } from '@/types';


const kLogPrefix = chalk.cyan('[Validation]');

/**
 * Sanitize a string by removing control characters and limiting length
 */
function sanitizeString(input: unknown, maxLength: number = 1000): string {
  if (typeof input !== 'string') {
    return '';
  }

  // Remove control characters except newlines and tabs
  let sanitized = input.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized.trim();
}

/**
 * Sanitize an array of strings
 */
function sanitizeStringArray(input: unknown, maxLength: number = 50, itemMaxLength: number = 100): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter(item => typeof item === 'string')
    .map(item => sanitizeString(item, itemMaxLength))
    .filter(item => item.length > 0)
    .slice(0, maxLength);
}

/**
 * Validate and sanitize a Google Fonts CSS URL
 */
function sanitizeGoogleFontsUrl(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length === 0) {
    return undefined;
  }

  const sanitized = sanitizeString(input, 2048);

  // Validate URL format
  try {
    new URL(sanitized);
  } catch {
    return undefined;
  }

  // Verify it's a Google Fonts CSS URL
  const lowerUrl = sanitized.toLowerCase();

  if (!lowerUrl.startsWith('https://fonts.googleapis.com/css')) {
    return undefined;
  }

  return sanitized;
}

/**
 * Zod schemas for validation
 */

// Platform type validation
const PlatformTypeSchema = z.enum(['twitch', 'youtube', 'telegram', 'vkvideo', 'kick', 'goodgame', 'site']);

const ConfigPlatformTypeSchema = z.enum(['twitch', 'youtube', 'telegram', 'vkvideo', 'kick', 'goodgame']);

// Platform schema
const PlatformSchema = z.object({
  id: PlatformTypeSchema,
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[A-Fa-f0-9]{6}$/),
  abbr: z.string().min(1).max(10)
}) satisfies z.ZodType<Platform>;

// Message ID schema
export const MessageIdSchema = z.string().min(1).max(128);

export { ChatMessageSchema };

// FontWidth schema (matches width type - number representing percentage)
const FontWidthSchema = z.number().min(50).max(200);

// FontStyle schema
const FontStyleSchema = z.object({
  weight: z.number().int().positive().min(100).max(950),
  style: z.enum(['normal', 'italic']),
  width: FontWidthSchema.optional()
});

// FontFamily schema
const FontFamilySchema = z.object({
  type: z.enum(['google', 'local']),
  family: z.string().max(200),
  styles: z.array(FontStyleSchema),
  subsets: z.array(z.string()).optional(),
  googlePopularity: z.number().optional()
});

// FontOption schema (extends FontFamily with selectedStyle)
const FontOptionSchema = FontFamilySchema.extend({
  selectedStyle: FontStyleSchema
});

const LineHeightSchema = z.number().min(0.8).max(3);
const ChatScaleSchema = z.number().min(0.5).max(1.5);

export const ChatSettingsSchema = z.object({
  showAvatars: z.boolean(),
  showBadges: z.boolean(),
  showModeratorBadges: z.boolean(),
  showEditedBadges: z.boolean(),
  showSubscriberBadges: z.boolean(),
  showVipBadges: z.boolean(),
  showEmotes: z.boolean(),
  showReplyTo: z.boolean(),
  filterBadWords: z.boolean(),
  filterLinks: z.boolean(),
  makeLinksClickable: z.boolean(),
  showApprovedTgVideosInChat: z.boolean(),
  tgVideoWidgetMinLoops: z.number().int().min(1).max(100),
  tgVideoWidgetMinDurationSec: z.number().int().min(1).max(600),
  badWords: z.array(z.string().min(1).max(100)),
  userFont: FontOptionSchema.nullable(),
  adminFont: FontOptionSchema.nullable(),
  usernameFont: FontOptionSchema.nullable(),
  adminLineHeight: LineHeightSchema,
  userLineHeight: LineHeightSchema,
  chatScale: ChatScaleSchema,
  adminScale: ChatScaleSchema,
});

// Partial ChatSettings schema for updates
export const PartialChatSettingsSchema = ChatSettingsSchema.partial();

// WebSocket message schemas
const ServerStatusSchema = z.object({
  type: z.literal(kWSMessageType.adminServerStatus),
  data: z.object({
    connected: z.boolean(),
    message: z.string().max(500).optional()
  })
});

const MessageUpdateSchema = z.object({
  type: z.literal(kWSMessageType.messageUpdate),
  data: z.object({
    messages: z.array(ChatMessageSchema).min(1).max(1000)
  })
});

const MessageUpdateDeletedIdsSchema = z.object({
  type: z.literal(kWSMessageType.messageUpdateDeletedIds),
  data: z.object({
    ids: z.array(MessageIdSchema).max(10000)
  })
});

const MessageClearAllSchema = z.object({
  type: z.literal(kWSMessageType.messageClearAll),
  data: z.object({})
});

const ChatSettingsWSSchema = z.object({
  type: z.literal(kWSMessageType.chatSettings),
  data: ChatSettingsSchema
});

const WidgetRefreshSchema = z.object({
  type: z.literal(kWSMessageType.widgetRefresh),
  data: z.object({})
});

const AdminDeleteMessageSchema = z.object({
  type: z.literal(kWSMessageType.adminDeleteMessage),
  data: z.object({
    ids: z.array(MessageIdSchema).min(1).max(1000)
  })
});

const AdminUpdateSettingsSchema = z.object({
  type: z.literal(kWSMessageType.adminUpdateSettings),
  data: PartialChatSettingsSchema
});

const AdminClearAllMessagesSchema = z.object({
  type: z.literal(kWSMessageType.adminClearAllMessages),
  data: z.object({})
});

const AdminRefreshWidgetSchema = z.object({
  type: z.literal(kWSMessageType.adminRefreshWidget),
  data: z.object({})
});

const TelegramVideoItemSchema = z.object({
  id: z.number(),
  fileId: z.string(),
  type: z.enum(['video', 'gif']),
  caption: z.string(),
  date: z.string(),
  filePath: z.string(),
  fileUrl: z.string(),
  chatMessageId: z.string(),
  pendingDate: z.string().optional(),
  thumbnail: z.string().nullable().optional(),
});

const TgVideoPendingUpdatedSchema = z.object({
  type: z.literal(kWSMessageType.tgVideoPendingUpdated),
  data: z.object({
    pending: z.array(TelegramVideoItemSchema),
  }),
});

const TgVideoApprovedSchema = z.object({
  type: z.literal(kWSMessageType.tgVideoApproved),
  data: TelegramVideoItemSchema,
});

const AdminTgVideoApproveSchema = z.object({
  type: z.literal(kWSMessageType.adminTgVideoApprove),
  data: z.object({
    id: z.number(),
  }),
});

const AdminTgVideoRejectSchema = z.object({
  type: z.literal(kWSMessageType.adminTgVideoReject),
  data: z.object({
    id: z.number(),
  }),
});

const EmoteQueueUpdatedSchema = z.object({
  type: z.literal(kWSMessageType.emoteQueueUpdated),
  data: z.object({
    emotes: z.array(SiteEmoteSchema).max(500),
  }),
});

const AdminEmoteReviewSchema = z.object({
  type: z.literal(kWSMessageType.adminEmoteReview),
  data: EmoteReviewSchema,
});

const AdminEmoteAddSchema = z.object({
  type: z.literal(kWSMessageType.adminEmoteAdd),
  data: EmoteAddSchema,
});

const AdminEmoteRenameSchema = z.object({
  type: z.literal(kWSMessageType.adminEmoteRename),
  data: EmoteRenameSchema,
});

const AdminEmoteDeleteSchema = z.object({
  type: z.literal(kWSMessageType.adminEmoteDelete),
  data: EmoteDeleteSchema,
});

const AdminPostQrSchema = z.object({
  type: z.literal(kWSMessageType.adminPostQr),
  data: z.object({
    text: z.string().max(500),
    url: z.string().min(1).max(2048),
  }),
});

const AdminPlatformsStatusSchema = z.object({
  type: z.literal(kWSMessageType.adminPlatformsStatus),
  data: z.object({
    platforms: z.array(PlatformSchema.extend({ active: z.boolean() }))
  })
});

const AdminPlatformStatusUpdateSchema = z.object({
  type: z.literal(kWSMessageType.adminPlatformStatusUpdate),
  data: z.object({
    platform: PlatformSchema.extend({ active: z.boolean() })
  })
});

// Union of all WebSocket message schemas
export const WSMessageSchema = z.discriminatedUnion('type', [
  ServerStatusSchema,
  MessageUpdateSchema,
  MessageUpdateDeletedIdsSchema,
  MessageClearAllSchema,
  ChatSettingsWSSchema,
  WidgetRefreshSchema,
  TgVideoPendingUpdatedSchema,
  TgVideoApprovedSchema,
  AdminDeleteMessageSchema,
  AdminUpdateSettingsSchema,
  AdminClearAllMessagesSchema,
  AdminRefreshWidgetSchema,
  AdminTgVideoApproveSchema,
  AdminTgVideoRejectSchema,
  EmoteQueueUpdatedSchema,
  AdminEmoteReviewSchema,
  AdminEmoteAddSchema,
  AdminEmoteRenameSchema,
  AdminEmoteDeleteSchema,
  AdminPostQrSchema,
  AdminPlatformsStatusSchema,
  AdminPlatformStatusUpdateSchema
]) as z.ZodType<WSMessage>;

/**
 * Validation functions
 */

/** Same chat-message rules as the site, from yobachat-shared. */
export function validateChatMessage(input: unknown): ChatMessage | null {
  return parseChatMessage(input);
}

/**
 * Validate a WebSocket message
 */
export function validateWSMessage(input: unknown): WSMessage | null {
  try {
    return WSMessageSchema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(`${kLogPrefix} WSMessage validation failed:`, error.issues);
    }

    return null;
  }
}

/**
 * Validate ChatSettings
 */
export function validateChatSettings(input: unknown): ChatSettings | null {
  try {
    // Sanitize bad words array
    if (typeof input === 'object' && input !== null) {
      const sanitized: any = { ...input };

      if ('badWords' in input) {
        sanitized.badWords = sanitizeStringArray((input as any).badWords, Number.MAX_SAFE_INTEGER, 100);
      }

      return ChatSettingsSchema.parse(sanitized) as ChatSettings;
    }

    return ChatSettingsSchema.parse(input) as ChatSettings;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(`${kLogPrefix} ChatSettings validation failed:`, error.issues);
    }

    return null;
  }
}

/**
 * Validate partial ChatSettings (for updates)
 */
export function validatePartialChatSettings(input: unknown): Partial<ChatSettings> | null {
  try {
    // Sanitize bad words array if present
    if (typeof input === 'object' && input !== null) {
      const sanitized: any = { ...input };

      if ('badWords' in input) {
        sanitized.badWords = sanitizeStringArray((input as any).badWords, Number.MAX_SAFE_INTEGER, 100);
      }

      return PartialChatSettingsSchema.parse(sanitized) as Partial<ChatSettings>;
    }

    return PartialChatSettingsSchema.parse(input) as Partial<ChatSettings>;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(`${kLogPrefix} Partial ChatSettings validation failed:`, error.issues);
    }

    return null;
  }
}

/**
 * Configuration validation schemas
 */

const TwitchServiceConfigSchema = z.object({
  channelId: z.string().min(1).max(100),
  webhookSecret: z.string().min(10).max(100)
}) satisfies z.ZodType<TwitchServiceConfig>;

const YouTubeServiceConfigSchema = z.object({
  channelId: z.string().min(1).max(100)
}) satisfies z.ZodType<YouTubeServiceConfig>;

const TelegramServiceConfigSchema = z.object({
  chatId: z.number().int().negative(),
  botToken: z.string().min(1).max(200),
  mode: z.enum(['polling', 'webhook']).optional(),
  pollInterval: z.number().int().positive().max(3600000).optional() // Max 1 hour
}) satisfies z.ZodType<TelegramServiceConfig>;

const VKVideoServiceConfigSchema = z.object({
  channelId: z.string().min(1).max(100),
  clientId: z.string().min(1).max(100),
  clientSecret: z.string().min(1).max(200)
}) satisfies z.ZodType<VKVideoServiceConfig>;

const KickServiceConfigSchema = z.object({
  channel: z.string().min(1).max(100)
}) satisfies z.ZodType<KickServiceConfig>;

const GoodgameServiceConfigSchema = z.object({
  channelId: z.string().min(1).max(100)
}) satisfies z.ZodType<GoodgameServiceConfig>;

const SharedConfigSchema = z.object({
  host: z.string().min(1).max(100),
  apiHost: z.string().min(1).max(100),
  basePath: z.string().min(1).max(100),
  wsPath: z.string().min(1).max(100),
  // Ignored if present (legacy)
  secure: z.unknown().optional(),
});

// Schema for the unified app config JSON file (shared + server fields)
export const AppConfigSchema = SharedConfigSchema.extend({
  apiPort: z.number().int().positive(),
  wsPort: z.number().int().positive(),
  webhookPort: z.number().int().positive(),
  webhookPath: z.string().min(1).max(100),
  consoleMode: z.boolean().optional(),
  enableConsoleOutput: z.boolean().optional(),
  adminPassword: z.string().min(4).max(200),
  telegram: TelegramServiceConfigSchema,
  youtube: YouTubeServiceConfigSchema,
  twitch: TwitchServiceConfigSchema,
  vkvideo: VKVideoServiceConfigSchema,
  kick: KickServiceConfigSchema,
  goodgame: GoodgameServiceConfigSchema,
  // Ignored if present (legacy BetterTTV / Twitch OAuth admin blocks)
  betterttv: z.unknown().optional(),
  admin: z.unknown().optional(),
  siteBridge: z.object({
    origin: z.string().regex(/^https?:\/\/[^/\s]+\/?$/),
    token: z.string().min(8).max(200),
  }).optional(),
  platforms: z.array(
      z.object({
      id: ConfigPlatformTypeSchema,
      name: z.string().min(1).max(100),
      color: z.string().regex(/^#[A-Fa-f0-9]{6}$/),
      abbr: z.string().min(1).max(10)
    })
  )
});

/** @deprecated Use AppConfigSchema */
export const ServerConfigSchema = AppConfigSchema;

/**
 * Validate unified app config file
 * Throws ZodError if validation fails
 */
export function validateAppConfigFile(config: unknown): AppConfigFile {
  try {
    return AppConfigSchema.parse(config) as AppConfigFile;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(`${kLogPrefix} AppConfig validation failed:`, error.issues);
    }

    throw error;
  }
}

/**
 * @deprecated Use validateAppConfigFile
 */
export function validateServerConfigFile(config: unknown): ServerConfigFile {
  return validateAppConfigFile(config);
}
