import { z } from 'zod';
import chalk from 'chalk';

import type { ChatMessage, ChatSettings, Platform, WSMessage, TwitchServiceConfig, YouTubeServiceConfig, TelegramServiceConfig, VKVideoServiceConfig, KickServiceConfig, GoodgameServiceConfig, BetterTTVConfig, SharedConfig } from '@shared/shared-types.js';
import { kWSMessageType } from '@shared/shared-types.js';
import type { ServerConfigFile, AdminConfig } from '@/types';


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
 * Sanitize a URL string
 */
function sanitizeUrl(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length === 0) {
    return undefined;
  }

  const sanitized = sanitizeString(input, 2048);

  // Basic URL validation
  try {
    new URL(sanitized);
    return sanitized;
  } catch {
    return undefined;
  }
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
 * Sanitize a color hex string
 */
function sanitizeColor(input: unknown): string | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }

  // Match hex color format (#RRGGBB)
  const match = input.match(/^#[A-Fa-f0-9]{6}$/);

  if (match) {
    return match[0];
  }

  return undefined;
}

/**
 * Zod schemas for validation
 */

// Platform type validation
const PlatformTypeSchema = z.enum(['twitch', 'youtube', 'telegram', 'vkvideo', 'kick', 'goodgame']);

// Platform schema
const PlatformSchema = z.object({
  id: PlatformTypeSchema,
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[A-Fa-f0-9]{6}$/),
  abbr: z.string().min(1).max(10)
}) satisfies z.ZodType<Platform>;

// Message ID schema
export const MessageIdSchema = z.string().min(1).max(128);

// ChatMessage schema with sanitization
export const ChatMessageSchema = z.object({
  id: MessageIdSchema,
  channel: z.string().min(1).max(200),
  username: z.string().min(0).max(100),
  message: z.string().min(0).max(5000),
  timestamp: z.number().int().positive(),
  platform: PlatformSchema,
  avatar: z.url().max(2048).optional(),
  badges: z.array(z.string().max(50)).max(20).optional(),
  badgeImages: z.record(z.string().max(50), z.url().max(2048)).optional(),
  color: z.string().regex(/^#[A-Fa-f0-9]{6}$/).optional(),
  isSubscriber: z.boolean().optional(),
  isModerator: z.boolean().optional(),
  isVip: z.boolean().optional(),
  isEdited: z.boolean().optional(),
  editDate: z.number().int().positive().optional(),
  emotesMap: z.record(z.string().max(100), z.string().max(2048)).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}) satisfies z.ZodType<ChatMessage>;

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
  filterBadWords: z.boolean(),
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

const AdminRefreshBetterTTVSchema = z.object({
  type: z.literal(kWSMessageType.adminRefreshBetterTTV),
  data: z.object({})
});

const AdminRefreshWidgetSchema = z.object({
  type: z.literal(kWSMessageType.adminRefreshWidget),
  data: z.object({})
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
  AdminDeleteMessageSchema,
  AdminUpdateSettingsSchema,
  AdminClearAllMessagesSchema,
  AdminRefreshBetterTTVSchema,
  AdminRefreshWidgetSchema,
  AdminPlatformsStatusSchema,
  AdminPlatformStatusUpdateSchema
]) as z.ZodType<WSMessage>;

/**
 * Validation functions
 */

/**
 * Validate and sanitize a ChatMessage
 * Always uses fast validation (sanitization only) for performance
 */
export function validateChatMessage(input: unknown): ChatMessage | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }

  const msg = input as any;

  // Quick type checks
  if (typeof msg.id !== 'string' || typeof msg.username !== 'string' || typeof msg.message !== 'string') {
    return null;
  }

  // Sanitize only critical fields (fast path)
  return {
    ...msg,
    id: MessageIdSchema.parse(msg.id),
    username: sanitizeString(msg.username, 100),
    message: sanitizeString(msg.message, 5000),
    channel: sanitizeString(msg.channel, 200),
    avatar: msg.avatar ? sanitizeUrl(msg.avatar) : undefined,
    badges: msg.badges ? sanitizeStringArray(msg.badges, 10, 50) : undefined,
    color: msg.color ? sanitizeColor(msg.color) : undefined
  } as ChatMessage;
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
  channelId: z.string().min(1).max(100)
}) satisfies z.ZodType<TwitchServiceConfig>;

const YouTubeServiceConfigSchema = z.object({
  channelId: z.string().min(1).max(100)
}) satisfies z.ZodType<YouTubeServiceConfig>;

const TelegramServiceConfigSchema = z.object({
  chatId: z.number().int().negative(),
  botToken: z.string().min(1).max(200),
  mode: z.enum(['polling', 'webhook']).optional(),
  certificatePath: z.string().min(1).max(500).optional(),
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

const BetterTTVConfigSchema = z.object({
  includeGlobal: z.boolean().optional(),
  includeChannel: z.boolean().optional(),
  channelId: z.string().min(1).max(100),
  color: z.string().regex(/^#[A-Fa-f0-9]{6}$/)
}) satisfies z.ZodType<BetterTTVConfig>;

const AdminConfigSchema = z.object({
  allowedTwitchUsernames: z.array(z.string().min(1).max(100)).min(1),
  twitchOAuth: z.object({
    clientId: z.string().min(1).max(200),
    clientSecret: z.string().min(1).max(200)
  })
});

const SharedConfigSchema = z.object({
  host: z.string().min(1).max(100),
  apiHost: z.string().min(1).max(100),
  basePath: z.string().min(1).max(100),
  wsPath: z.string().min(1).max(100)
}) satisfies z.ZodType<SharedConfig>;

// Schema for server config JSON file
export const ServerConfigSchema = z.object({
  apiPort: z.number().int().positive(),
  wsPort: z.number().int().positive(),
  webhookPort: z.number().int().positive(),
  webhookPath: z.string().min(1).max(100),
  consoleMode: z.boolean().optional(),
  enableConsoleOutput: z.boolean().optional(),
  telegram: TelegramServiceConfigSchema,
  youtube: YouTubeServiceConfigSchema,
  twitch: TwitchServiceConfigSchema,
  vkvideo: VKVideoServiceConfigSchema,
  kick: KickServiceConfigSchema,
  goodgame: GoodgameServiceConfigSchema,
  betterttv: BetterTTVConfigSchema,
  admin: AdminConfigSchema,
  platforms: z.array(
      z.object({
      id: PlatformTypeSchema,
      name: z.string().min(1).max(100),
      color: z.string().regex(/^#[A-Fa-f0-9]{6}$/),
      abbr: z.string().min(1).max(10)
    })
  )
});

/**
 * Validate server config file
 * Throws ZodError if validation fails
 */
export function validateServerConfigFile(config: unknown): ServerConfigFile {
  try {
    return ServerConfigSchema.parse(config) as ServerConfigFile;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(`${kLogPrefix} ServerConfig validation failed:`, error.issues);
    }

    throw error;
  }
}
