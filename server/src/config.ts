import { readFileSync } from 'fs';
import { join, resolve } from 'path';

import type { PlatformWithConfig, ServerConfig } from "@/types.js"

import type {
  TelegramServiceConfig,
  YouTubeServiceConfig,
  TwitchServiceConfig,
  VKVideoServiceConfig,
  KickServiceConfig,
  BetterTTVConfig,
  SharedConfig
} from "@shared/shared-types.js"

import { validateServerConfigFile } from '@/validation.js';


/**
 * Parse command-line arguments for config file paths
 */
interface ConfigArgs {
  sharedConfig?: string;
  serverConfig?: string;
}

function parseArgs(): ConfigArgs {
  const args: ConfigArgs = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--shared-config' && i + 1 < argv.length) {
      args.sharedConfig = resolve(argv[i + 1]);
      i++;
    } else if (argv[i] === '--server-config' && i + 1 < argv.length) {
      args.serverConfig = resolve(argv[i + 1]);
      i++;
    }
  }

  return args;
}

/**
 * Load shared configuration from JSON file
 */
function loadSharedConfig(configPath?: string): SharedConfig {
  const envPath = process.env.SHARED_CONFIG_PATH;
  const configFilePath = configPath || (envPath ? resolve(envPath) : undefined) || join(process.cwd(), 'shared', 'shared-config.json');

  try {
    const fileContent = readFileSync(configFilePath, 'utf-8');
    const rawConfig = JSON.parse(fileContent);

    // Validate required fields
    if (
      typeof rawConfig !== 'object' ||
      typeof rawConfig.host !== 'string' ||
      typeof rawConfig.apiHost !== 'string' ||
      typeof rawConfig.basePath !== 'string' ||
      typeof rawConfig.wsPath !== 'string'
    ) {
      throw new Error('Invalid shared-config.json: missing or invalid required fields');
    }

    return {
      host: rawConfig.host,
      apiHost: rawConfig.apiHost,
      basePath: rawConfig.basePath,
      wsPath: rawConfig.wsPath,
    };
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[SharedConfig] Failed to load config from ${configFilePath}: ${error.message}`);
      if (error instanceof SyntaxError) {
        console.error(`[SharedConfig] Invalid JSON format in ${configFilePath}`);
      }
    }
    throw error;
  }
}

/**
 * Load and validate server configuration from JSON file
 */
function loadServerConfig(serverConfigPath?: string, sharedConfigPath?: string): ServerConfig {
  const envServerPath = process.env.SERVER_CONFIG_PATH;
  const
    sharedConfig = loadSharedConfig(sharedConfigPath),
    configPath = serverConfigPath || (envServerPath ? resolve(envServerPath) : undefined) || join(process.cwd(), 'server-config.json');

  try {
    const fileContent = readFileSync(configPath, 'utf-8');
    const rawConfig = JSON.parse(fileContent);

    // Validate the entire config file structure
    const validatedConfig = validateServerConfigFile(rawConfig);

    // Get console mode settings from JSON
    const consoleMode = validatedConfig.consoleMode ?? false;
    const enableConsoleOutput = validatedConfig.enableConsoleOutput ?? false;

    // Map platforms array to include their configs
    const platforms: PlatformWithConfig[] = validatedConfig.platforms.map(platform => {
      let config:
        TelegramServiceConfig |
        YouTubeServiceConfig |
        TwitchServiceConfig |
        VKVideoServiceConfig |
        KickServiceConfig;

      switch (platform.id) {
        case 'telegram':
          config = validatedConfig.telegram;
          break;
        case 'youtube':
          config = validatedConfig.youtube;
          break;
        case 'twitch':
          config = validatedConfig.twitch;
          break;
        case 'vkvideo':
          config = validatedConfig.vkvideo;
          break;
        case 'kick':
          config = validatedConfig.kick;
          break;
        default:
          throw new Error(`Unknown platform ID: ${platform.id}`);
      }

      return {
        ...platform,
        config
      } as PlatformWithConfig;
    });

    // Combine base server config with file config
    return {
      consoleMode,
      enableConsoleOutput,
      apiPort: validatedConfig.apiPort,
      wsPort: validatedConfig.wsPort,
      webhookPort: validatedConfig.webhookPort,
      webhookPath: validatedConfig.webhookPath,
      sharedConfig,
      telegram: validatedConfig.telegram,
      youtube: validatedConfig.youtube,
      twitch: validatedConfig.twitch,
      vkvideo: validatedConfig.vkvideo,
      kick: validatedConfig.kick,
      betterttv: validatedConfig.betterttv,
      platforms
    };
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[Config] Failed to load config from ${configPath}: ${error.message}`);
      if (error instanceof SyntaxError) {
        console.error(`[Config] Invalid JSON format in ${configPath}`);
      }
    }
    throw error;
  }
}

/**
 * Hidden badges filter
 */
export const kHiddenBadgesFilter: string[] = [
  'moderator',
  'subscriber',
  'vip'
]

// Parse command-line arguments
const configArgs = parseArgs();

// Load and validate configs from JSON file
export const kServerConfig: ServerConfig = loadServerConfig(configArgs.serverConfig, configArgs.sharedConfig);

export const kConsoleMode: boolean = kServerConfig.consoleMode ?? false;
export const kEnableConsoleOutput: boolean = kServerConfig.enableConsoleOutput ?? false;
export const kTelegramConfig: TelegramServiceConfig = kServerConfig.telegram;
export const kYouTubeConfig: YouTubeServiceConfig = kServerConfig.youtube;
export const kTwitchConfig: TwitchServiceConfig = kServerConfig.twitch;
export const kVKVideoConfig: VKVideoServiceConfig = kServerConfig.vkvideo;
export const kKickConfig: KickServiceConfig = kServerConfig.kick;
export const kBetterTTVConfig: BetterTTVConfig = kServerConfig.betterttv;
export const kPlatformsConfig: PlatformWithConfig[] = kServerConfig.platforms;
