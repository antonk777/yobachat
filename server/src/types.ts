import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';

import type { BetterTTVConfig, ChatMessage, ChatMessageDelete, Platform, PlatformType, TelegramServiceConfig, TwitchServiceConfig, VKVideoServiceConfig, YouTubeServiceConfig, KickServiceConfig, GoodgameServiceConfig, SharedConfig } from '@shared/shared-types.js';

// Base interface for all service events
export interface PlatformServiceEvents {
  'messageUpdated': [message: ChatMessage];
  'messageDeleted': [deleteEvent: ChatMessageDelete];
  'status': [active: boolean];
}

// Interfaces

/**
 * Type representing the validated JSON structure from server-config.json
 * (platforms don't have config yet - that's added during loading)
 */
export type ServerConfigFile = {
  consoleMode?: boolean;
  enableConsoleOutput?: boolean;
  apiPort: number;
  wsPort: number;
  webhookPort: number;
  webhookPath: string;
  telegram: TelegramServiceConfig;
  youtube: YouTubeServiceConfig;
  twitch: TwitchServiceConfig;
  vkvideo: VKVideoServiceConfig;
  kick: KickServiceConfig;
  goodgame: GoodgameServiceConfig;
  betterttv: BetterTTVConfig;
  platforms: Platform[];
};

export type ServerConfig = ServerConfigFile & {
  sharedConfig: SharedConfig;
  platforms: PlatformWithConfig[];
};

export interface PlatformService extends EventEmitter<PlatformServiceEvents> {
  /**
   * The platform information
   */
  readonly platform: Platform;

  /**
   * Start watching for chat messages
   */
  start(): Promise<void>;

  /**
   * Stop watching for chat messages
   */
  stop(): Promise<void>;

  /**
   * Check if the service is currently active
   */
  isActive(): boolean;
}

export type PlatformConfig =
  | TwitchServiceConfig
  | YouTubeServiceConfig
  | TelegramServiceConfig
  | VKVideoServiceConfig
  | KickServiceConfig
  | GoodgameServiceConfig;

export interface PlatformWithConfig<T extends PlatformConfig = PlatformConfig> extends Platform {
  config: T;
}

export interface PlatformWithService<T extends PlatformConfig = PlatformConfig> extends PlatformWithConfig<T> {
  service: PlatformService | null;
}

// Health Check types

export type HealthStatusType =
  | 'operational'    // All systems working perfectly
  | 'degraded'       // Some platforms down but service functional
  | 'critical'       // All platforms down or critical failure
  | 'starting'       // Server initializing (first 30 seconds)
  | 'overloaded';    // High memory usage or resource constraints

export interface HealthStatus {
  status: HealthStatusType;
  timestamp: string;
  uptime: number;
  platforms: Array<{
    name: string;
    id: string;
    active: boolean;
  }>;
  platformStats: {
    total: number;
    active: number;
    inactive: number;
  };
  websocket: {
    enabled: boolean;
    connections: number;
    healthy: boolean;
  };
  memory: {
    used: number;
    total: number;
    external: number;
    usagePercent: number;
    healthy: boolean;
  };
  node: {
    version: string;
    platform: string;
  };
  issues: string[]; // Array of issue descriptions
}

export interface HealthCheckConfig {
  port: number;
  authToken?: string;
}

export type HealthStatusProvider = () => HealthStatus;

// Guards

export const isValidPlatform = (platform: string): platform is PlatformType => {
  switch (platform) {
    case 'twitch':
    case 'youtube':
    case 'telegram':
    case 'vkvideo':
    case 'kick':
    case 'goodgame':
      return true;
    default:
      return false;
  }
};

// YouTube Data API v3 types - using official types from @maxim_mazurok/gapi.client.youtube-v3
// The gapi namespace is available globally when @maxim_mazurok/gapi.client.youtube-v3 is installed

// Re-export official types with shorter names for convenience
export type YouTubeSearchResponse = gapi.client.youtube.SearchListResponse;
export type YouTubeVideoResponse = gapi.client.youtube.VideoListResponse;
export type YouTubeLiveChatResponse = gapi.client.youtube.LiveChatMessageListResponse;
export type YouTubeLiveChatMessage = gapi.client.youtube.LiveChatMessage;

// Webhook types
export type WebhookHandler = (req: Request, res: Response) => void;
