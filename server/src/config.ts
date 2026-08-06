import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

import type { PlatformWithConfig, ServerConfig, ServerConfigFile } from "@/types.js"

import type {
  TelegramServiceConfig,
  YouTubeServiceConfig,
  TwitchServiceConfig,
  VKVideoServiceConfig,
  KickServiceConfig,
  GoodgameServiceConfig,
} from "@shared/shared-types.js"

import { pickSharedConfig } from '@shared/shared-urls.js';
import { validateAppConfigFile } from '@/validation.js';


interface ConfigArgs {
  config?: string;
}

export const kIsDev: boolean = process.env.NODE_ENV === 'development';

function parseArgs(): ConfigArgs {
  const args: ConfigArgs = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && i + 1 < argv.length) {
      args.config = resolve(argv[i + 1]);
      i++;
    }
  }

  return args;
}

function resolveConfigPath(explicit?: string): string {
  if (explicit) {
    return resolve(explicit);
  }

  if (process.env.CONFIG_PATH) {
    return resolve(process.env.CONFIG_PATH);
  }

  const candidates = [
    join(process.cwd(), 'config.json'),
    join(process.cwd(), '..', 'config.json'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

/**
 * Load and validate the unified app config from a single JSON file
 */
function loadAppConfig(configPath?: string): ServerConfig {
  const filePath = resolveConfigPath(configPath);

  try {
    const fileContent = readFileSync(filePath, 'utf-8');
    const rawConfig = JSON.parse(fileContent);
    const validatedConfig = validateAppConfigFile(rawConfig);
    const sharedConfig = pickSharedConfig(validatedConfig);

    const consoleMode = validatedConfig.consoleMode ?? false;
    const enableConsoleOutput = validatedConfig.enableConsoleOutput ?? false;

    const platforms: PlatformWithConfig[] = validatedConfig.platforms.map(platform => {
      let config:
        TelegramServiceConfig |
        YouTubeServiceConfig |
        TwitchServiceConfig |
        VKVideoServiceConfig |
        KickServiceConfig |
        GoodgameServiceConfig;

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
        case 'goodgame':
          config = validatedConfig.goodgame;
          break;
        default:
          throw new Error(`Unknown platform ID: ${platform.id}`);
      }

      return {
        ...platform,
        config
      } as PlatformWithConfig;
    });

    const serverFields: ServerConfigFile = validatedConfig;

    return {
      consoleMode,
      enableConsoleOutput,
      apiPort: serverFields.apiPort,
      wsPort: serverFields.wsPort,
      webhookPort: serverFields.webhookPort,
      webhookPath: serverFields.webhookPath,
      adminPassword: serverFields.adminPassword,
      sharedConfig,
      telegram: serverFields.telegram,
      youtube: serverFields.youtube,
      twitch: serverFields.twitch,
      vkvideo: serverFields.vkvideo,
      kick: serverFields.kick,
      goodgame: serverFields.goodgame,
      platforms
    };
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[Config] Failed to load config from ${filePath}: ${error.message}`);
      if (error instanceof SyntaxError) {
        console.error(`[Config] Invalid JSON format in ${filePath}`);
      }
    }
    throw error;
  }
}

export const kHiddenBadgesFilter: string[] = [
  'moderator',
  'subscriber',
  'vip'
]

const configArgs = parseArgs();

export const kServerConfig: ServerConfig = loadAppConfig(configArgs.config);

export const kConsoleMode: boolean = kServerConfig.consoleMode ?? false;
export const kEnableConsoleOutput: boolean = kServerConfig.enableConsoleOutput ?? false;
export const kTelegramConfig: TelegramServiceConfig = kServerConfig.telegram;
export const kYouTubeConfig: YouTubeServiceConfig = kServerConfig.youtube;
export const kTwitchConfig: TwitchServiceConfig = kServerConfig.twitch;
export const kVKVideoConfig: VKVideoServiceConfig = kServerConfig.vkvideo;
export const kKickConfig: KickServiceConfig = kServerConfig.kick;
export const kGoodgameConfig: GoodgameServiceConfig = kServerConfig.goodgame;
export const kPlatformsConfig: PlatformWithConfig[] = kServerConfig.platforms;
