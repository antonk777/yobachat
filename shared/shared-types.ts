// Types

export type PlatformType = 'twitch' | 'youtube' | 'telegram' | 'vkvideo' | 'kick' | 'goodgame';

export type WidgetType = 'user' | 'admin';

// Interfaces

export interface BetterTTVConfig {
  includeGlobal?: boolean;
  includeChannel?: boolean;
  channelId: string;
  color: string;
}

export interface TwitchServiceConfig {
  channelId: string;
}

export interface YouTubeServiceConfig {
  channelId: string;
  apiKey: string;
  pollInterval: number;
}

export interface TelegramServiceConfig {
  chatId: number;
  botToken: string;
  mode?: 'polling' | 'webhook'; // Default: 'webhook' if webhookUrl is provided, otherwise 'polling'
  certificatePath?: string; // Required only for webhook mode
  pollInterval?: number; // Polling interval in milliseconds (default: 1000)
}

export interface VKVideoServiceConfig {
  channelId: string;
  clientId: string;
  clientSecret: string;
}

export interface KickServiceConfig {
  channel: string; // Channel name or chat ID
}

export interface GoodgameServiceConfig {
  channelId: string; // Channel ID (e.g., "5")
}

export interface SharedConfig {
  /**Public domain name for client */
  host: string;
  /**Public domain name for API */
  apiHost: string;
  /**Subpath for client used for public access*/
  basePath: string;
  /**Subpath for WebSocket server used for public access*/
  wsPath: string;
}

export interface Platform {
  id: PlatformType;
  name: string;
  color: string;
  abbr: string;
}

export interface PlatformWithStatus extends Platform {
  active: boolean;
}

export type ChatMessageSegment = {
  type: 'text';
  content: string;
} | {
  type: 'emote';
  content: string;
  url: string;
};

export interface ChatMessage {
  id: string;
  channel: string;
  username: string;
  message: string;
  timestamp: number;
  platform: Platform;
  avatar?: string;
  badges?: string[];
  badgeImages?: Record<string, string>;
  color?: string;
  isSubscriber?: boolean;
  isModerator?: boolean;
  isVip?: boolean;
  isEdited?: boolean;
  editDate?: number;
  emotesMap?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface ChatMessageWithSegments extends ChatMessage {
  usernameFiltered: string;
  segments: ChatMessageSegment[];
}

export interface ChatMessageUpdate {
  message: ChatMessage;
}

export interface ChatMessageDelete {
  id: string;
}

export interface ChatMessageUpdateDeletedIds {
  ids: string[];
}

export interface ServerStatus {
  connected: boolean;
  message?: string;
}

export interface ChatSettings {
  showAvatars: boolean;
  showBadges: boolean;
  showModeratorBadges: boolean;
  showEditedBadges: boolean;
  showSubscriberBadges: boolean;
  showVipBadges: boolean;
  showEmotes: boolean;
  filterBadWords: boolean;
  badWords: string[];
  userFont: FontOption | null;
  adminFont: FontOption | null;
  adminLineHeight: number;
  userLineHeight: number;
}

export enum kWSMessageType {
  serverStatus = 'serverStatus',
  messageUpdate = 'messageUpdate',
  messageUpdateDeletedIds = 'messageUpdateDeletedIds',
  messageClearAll = 'messageClearAll',
  chatSettings = 'chatSettings',

  // Admin commands (client -> server)
  adminDeleteMessage = 'adminDeleteMessage',
  adminUpdateSettings = 'adminUpdateSettings',
  adminClearAllMessages = 'adminClearAllMessages',
  adminRefreshBetterTTV = 'adminRefreshBetterTTV',

  // Admin responses (server -> client)
  adminPlatformsStatus = 'adminPlatformsStatus',
  adminPlatformStatusUpdate = 'adminPlatformStatusUpdate',
}

export interface WSServerStatus {
  type: kWSMessageType.serverStatus;
  data: ServerStatus;
}

export interface WSMessageUpdate {
  type: kWSMessageType.messageUpdate;
  data: ChatMessageUpdate;
}

export interface WSMessageUpdateDeletedIds {
  type: kWSMessageType.messageUpdateDeletedIds;
  data: ChatMessageUpdateDeletedIds;
}

export interface WSMessageClearAll {
  type: kWSMessageType.messageClearAll;
  data: {};
}

export interface WSMessageChatSettings {
  type: kWSMessageType.chatSettings;
  data: ChatSettings;
}

// Admin command interfaces
export interface WSAdminDeleteMessage {
  type: kWSMessageType.adminDeleteMessage;
  data: { ids: string[] };
}

export interface WSAdminUpdateSettings {
  type: kWSMessageType.adminUpdateSettings;
  data: Partial<ChatSettings>;
}

export interface WSAdminClearAllMessages {
  type: kWSMessageType.adminClearAllMessages;
  data: {};
}

export interface WSAdminRefreshBetterTTV {
  type: kWSMessageType.adminRefreshBetterTTV;
  data: {};
}

// Admin response interfaces
export interface WSAdminPlatformsStatus {
  type: kWSMessageType.adminPlatformsStatus;
  data: {
    platforms: Array<PlatformWithStatus>
  };
}

export interface WSAdminPlatformStatusUpdate {
  type: kWSMessageType.adminPlatformStatusUpdate;
  data: { platform: PlatformWithStatus };
}

export type WSMessageTypeMap = {
  // Client responses (server -> client)
  [kWSMessageType.serverStatus]: WSServerStatus;
  [kWSMessageType.messageUpdate]: WSMessageUpdate;
  [kWSMessageType.messageUpdateDeletedIds]: WSMessageUpdateDeletedIds;
  [kWSMessageType.messageClearAll]: WSMessageClearAll;
  [kWSMessageType.chatSettings]: WSMessageChatSettings;

  // Admin commands (client -> server)
  [kWSMessageType.adminDeleteMessage]: WSAdminDeleteMessage;
  [kWSMessageType.adminUpdateSettings]: WSAdminUpdateSettings;
  [kWSMessageType.adminClearAllMessages]: WSAdminClearAllMessages;
  [kWSMessageType.adminRefreshBetterTTV]: WSAdminRefreshBetterTTV;
  [kWSMessageType.adminPlatformsStatus]: WSAdminPlatformsStatus;
  [kWSMessageType.adminPlatformStatusUpdate]: WSAdminPlatformStatusUpdate;
}

export type WSMessage =
  WSServerStatus
  | WSMessageUpdate
  | WSMessageUpdateDeletedIds
  | WSMessageClearAll
  | WSMessageChatSettings
  | WSAdminDeleteMessage
  | WSAdminUpdateSettings
  | WSAdminClearAllMessages
  | WSAdminRefreshBetterTTV
  | WSAdminPlatformsStatus
  | WSAdminPlatformStatusUpdate;

export interface FontFamily {
  type: 'google' | 'local';
  family: string;
  styles: FontStyle[]
  subsets?: string[] // Use for scripts like latin, cyrillic, etc.
  googlePopularity?: number // Use for sorting Google Fonts list
}

export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export type FontStyleName = 'normal' | 'italic';

export interface FontStyle {
  weight: FontWeight;
  style: FontStyleName;
}

export interface FontOption extends FontFamily {
  selectedStyle: FontStyle;
}