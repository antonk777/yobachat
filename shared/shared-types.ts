// Types

export type PlatformType = 'twitch' | 'youtube' | 'telegram' | 'vkvideo' | 'kick' | 'goodgame';

export type WidgetType = 'user' | 'admin';

// Interfaces

export interface TwitchServiceConfig {
  channelId: string;
  /** 10–100 ASCII characters; passed to Helix and used for EventSub HMAC verification. */
  webhookSecret: string;
}

export interface YouTubeServiceConfig {
  channelId: string;
}

export interface TelegramServiceConfig {
  chatId: number;
  botToken: string;
  mode?: 'polling' | 'webhook'; // Default: 'webhook' if webhookUrl is provided, otherwise 'polling'
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
} | {
  type: 'link';
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
  replyToId?: string; // Message ID of the message this message is replying to
}

export interface ChatMessageClient extends ChatMessage {
  usernameFiltered: string;
  segments: ChatMessageSegment[];
  replyTo?: ChatMessageClient;
}

export interface ChatMessageUpdate {
  messages: ChatMessage[];
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
  timestamp?: number;
}

export interface ServerStatusConnection extends ServerStatus {
  type: 'connection' | 'server';
  message?: string;
  timestamp: number;
}

export interface ChatSettings {
  showAvatars: boolean;
  showBadges: boolean;
  showModeratorBadges: boolean;
  showEditedBadges: boolean;
  showSubscriberBadges: boolean;
  showVipBadges: boolean;
  showEmotes: boolean;
  showReplyTo: boolean;
  filterBadWords: boolean;
  filterLinks: boolean;
  makeLinksClickable: boolean;
  /** When true: Admin shows pending/approved TG videos in message bodies; OBS chat shows approved videos */
  showApprovedTgVideosInChat: boolean;
  /** OBS /tg-video.html: hide after at least this many completed loops (and min duration) */
  tgVideoWidgetMinLoops: number;
  /** OBS /tg-video.html: hide after at least this many seconds (and min loops) */
  tgVideoWidgetMinDurationSec: number;
  badWords: string[];
  userFont: FontOption | null;
  adminFont: FontOption | null;
  usernameFont: FontOption | null;
  adminLineHeight: number;
  userLineHeight: number;
  chatScale: number;
  adminScale: number;
}

export type TelegramVideoMediaType = 'video' | 'gif';

export type TelegramVideoStatus = 'pending' | 'approved';

/** Attached to ChatMessage.metadata.tgVideo */
export interface TelegramVideoMeta {
  type: TelegramVideoMediaType;
  fileId: string;
  fileUrl: string;
  status: TelegramVideoStatus;
  /** Queue id used for approve/reject */
  queueId: number;
}

export interface TelegramVideoItem {
  id: number;
  fileId: string;
  type: TelegramVideoMediaType;
  caption: string;
  date: string;
  filePath: string;
  fileUrl: string;
  chatMessageId: string;
  pendingDate?: string;
  thumbnail?: string | null;
}

export enum kWSMessageType {
  messageUpdate = 'messageUpdate',
  messageUpdateDeletedIds = 'messageUpdateDeletedIds',
  messageClearAll = 'messageClearAll',
  chatSettings = 'chatSettings',
  widgetRefresh = 'widgetRefresh',

  // Telegram video (server -> client)
  tgVideoPendingUpdated = 'tgVideoPendingUpdated',
  tgVideoApproved = 'tgVideoApproved',

  // Admin commands (client -> server)
  adminDeleteMessage = 'adminDeleteMessage',
  adminUpdateSettings = 'adminUpdateSettings',
  adminClearAllMessages = 'adminClearAllMessages',
  adminRefreshWidget = 'adminRefreshWidget',
  adminTgVideoApprove = 'adminTgVideoApprove',
  adminTgVideoReject = 'adminTgVideoReject',

  // Admin responses (server -> client)
  adminServerStatus = 'adminServerStatus',
  adminPlatformsStatus = 'adminPlatformsStatus',
  adminPlatformStatusUpdate = 'adminPlatformStatusUpdate',
}

export interface WSServerStatus {
  type: kWSMessageType.adminServerStatus;
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

export interface WSWidgetRefresh {
  type: kWSMessageType.widgetRefresh;
  data: {};
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

export interface WSAdminRefreshWidget {
  type: kWSMessageType.adminRefreshWidget;
  data: {};
}

export interface WSTgVideoPendingUpdated {
  type: kWSMessageType.tgVideoPendingUpdated;
  data: { pending: TelegramVideoItem[] };
}

export interface WSTgVideoApproved {
  type: kWSMessageType.tgVideoApproved;
  data: TelegramVideoItem;
}

export interface WSAdminTgVideoApprove {
  type: kWSMessageType.adminTgVideoApprove;
  data: { id: number };
}

export interface WSAdminTgVideoReject {
  type: kWSMessageType.adminTgVideoReject;
  data: { id: number };
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
  [kWSMessageType.adminServerStatus]: WSServerStatus;
  [kWSMessageType.messageUpdate]: WSMessageUpdate;
  [kWSMessageType.messageUpdateDeletedIds]: WSMessageUpdateDeletedIds;
  [kWSMessageType.messageClearAll]: WSMessageClearAll;
  [kWSMessageType.chatSettings]: WSMessageChatSettings;
  [kWSMessageType.widgetRefresh]: WSWidgetRefresh;
  [kWSMessageType.tgVideoPendingUpdated]: WSTgVideoPendingUpdated;
  [kWSMessageType.tgVideoApproved]: WSTgVideoApproved;

  // Admin commands (client -> server)
  [kWSMessageType.adminDeleteMessage]: WSAdminDeleteMessage;
  [kWSMessageType.adminUpdateSettings]: WSAdminUpdateSettings;
  [kWSMessageType.adminClearAllMessages]: WSAdminClearAllMessages;
  [kWSMessageType.adminRefreshWidget]: WSAdminRefreshWidget;
  [kWSMessageType.adminTgVideoApprove]: WSAdminTgVideoApprove;
  [kWSMessageType.adminTgVideoReject]: WSAdminTgVideoReject;
  [kWSMessageType.adminPlatformsStatus]: WSAdminPlatformsStatus;
  [kWSMessageType.adminPlatformStatusUpdate]: WSAdminPlatformStatusUpdate;
}

export type WSMessage =
  WSServerStatus
  | WSMessageUpdate
  | WSMessageUpdateDeletedIds
  | WSMessageClearAll
  | WSMessageChatSettings
  | WSWidgetRefresh
  | WSTgVideoPendingUpdated
  | WSTgVideoApproved
  | WSAdminDeleteMessage
  | WSAdminUpdateSettings
  | WSAdminClearAllMessages
  | WSAdminRefreshWidget
  | WSAdminTgVideoApprove
  | WSAdminTgVideoReject
  | WSAdminPlatformsStatus
  | WSAdminPlatformStatusUpdate;

export interface FontFamily {
  type: 'google' | 'local';
  family: string;
  styles: FontStyle[]
  subsets?: string[] // Use for scripts like latin, cyrillic, etc.
  googlePopularity?: number // Use for sorting Google Fonts list
}

export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;

export type FontStyleName = 'normal' | 'italic';

export interface FontStyle {
  weight: FontWeight;
  style: FontStyleName;
  width?: number;
}

export type FontWidth = number;

export interface FontOption extends FontFamily {
  selectedStyle: FontStyle;
}