import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import { join, dirname } from 'path';
import chalk from 'chalk';

import type { ChatSettings } from '@shared/shared-types.js';

import { kDefaultChatSettings } from '@shared/shared-constants';
import { validateChatSettings, validatePartialChatSettings } from '@/validation.js';


/**
 * Unified storage service for chat settings, deleted messages, and bad words
 */
export class SettingsService {
  public logPrefix = chalk.cyan('[Settings]');

  private settings: ChatSettings = { ...kDefaultChatSettings };
  private filePath: string;

  constructor() {
    this.filePath = join(process.cwd(), 'storage', 'settings.json');
  }

  /**
   * Initialize the service by loading settings from disk
   */
  async init(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      await access(this.filePath, constants.F_OK);
    } catch {
      // File doesn't exist, use defaults
      this.settings = { ...kDefaultChatSettings };
      return;
    }

    try {
      const content = await readFile(this.filePath, 'utf-8');

      const parsed = JSON.parse(content) as Partial<ChatSettings>;

      // Validate loaded settings
      const validated = validateChatSettings({
        ...kDefaultChatSettings,
        ...parsed
      });

      if (validated) {
        this.settings = validated;
      } else {
        console.warn(`${this.logPrefix} Invalid settings loaded, using defaults`);
        this.settings = { ...kDefaultChatSettings };
      }
    } catch (error) {
      console.warn(`${this.logPrefix} Failed to load settings: ${error}`);
      this.settings = { ...kDefaultChatSettings };
    }
  }

  private async save(): Promise<void> {
    try {
      // Ensure the storage directory exists
      const storageDir = dirname(this.filePath);
      await mkdir(storageDir, { recursive: true });

      await writeFile(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (error) {
      console.error(`${this.logPrefix} Failed to save settings: ${error}`);
    }
  }

  // Chat Settings methods
  getChatSettings(): ChatSettings {
    return this.settings;
  }

  isValidChatSettings(partial: Partial<ChatSettings>): partial is Partial<ChatSettings> {
    return validatePartialChatSettings(partial) !== null;
  }

  async updateChatSettings(partial: Partial<ChatSettings>): Promise<ChatSettings> {
    // Validate and sanitize settings before updating
    const validated = validatePartialChatSettings(partial);

    if (!validated) {
      throw new Error('Invalid chat settings');
    }

    this.settings = {
      ...kDefaultChatSettings,
      ...this.settings,
      ...validated
    };

    await this.save();

    return this.getChatSettings();
  }
}

