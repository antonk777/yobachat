import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import { dirname } from 'path';
import chalk from 'chalk';

import type { ChatMessage } from '@shared/shared-types.js';

import { ChatMessageSchema } from '@/validation.js';
import { kMaxHistoryMessages } from '@shared/shared-constants';
import { kIsDev } from '@/config';
import { storageFile } from '@/storage-path.js';

const kSaveThrottleMS = 5000; // 5 seconds

/**
 * Service for managing message history with persistent storage
 */
export class MessageHistoryService {
  public logPrefix = chalk.magenta('[MessageHistory]');

  private messageHistory: ChatMessage[] = [];
  private filePath: string = storageFile('message-history.json');
  private saveTimeout: NodeJS.Timeout | null = null;
  private pendingSave: boolean = false;

  /**
   * Initialize the service by loading message history from disk
   */
  async init(): Promise<void> {
    await this.load();
  }

  /**
   * Load message history from disk
   */
  private async load(): Promise<void> {
    try {
      await access(this.filePath, constants.F_OK);
    } catch {
      // File doesn't exist, start with empty array
      this.messageHistory = [];
      return;
    }

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(content);

      // Validate that it's an array
      if (!Array.isArray(parsed)) {
        this.messageHistory = [];
        return;
      }

      // Validate each message with Zod schema
      const validMessages: ChatMessage[] = [];

      for (let i = 0; i < parsed.length; i++) {
        try {
          const validatedMessage = ChatMessageSchema.parse(parsed[i]);
          validMessages.push(validatedMessage);
        } catch (error) {
          console.warn(`${this.logPrefix} Invalid message in message history: ${error}`);
        }
      }

      this.messageHistory = validMessages;

      // Ensure we don't exceed kMaxMessages
      if (this.messageHistory.length > kMaxHistoryMessages) {
        this.messageHistory = this.messageHistory.slice(-kMaxHistoryMessages);
      }
    } catch (error) {
      console.warn(`${this.logPrefix} Failed to load message history: ${error}`);
      this.messageHistory = [];
    }
  }

  /**
   * Save message history to disk (throttled)
   */
  private scheduleSave(): void {
    // If a save is already scheduled, don't schedule another one
    if (this.saveTimeout !== null) {
      this.pendingSave = true;
      return;
    }

    // Schedule save after throttle period
    this.saveTimeout = setTimeout(async () => {
      await this.save();
      this.saveTimeout = null;

      // If there was a pending save request while we were saving, schedule another one
      if (this.pendingSave) {
        this.pendingSave = false;
        this.scheduleSave();
      }
    }, kSaveThrottleMS);
  }

  /**
   * Save message history to disk immediately
   */
  private async save(): Promise<void> {
    try {
      // Ensure the storage directory exists
      const storageDir = dirname(this.filePath);
      await mkdir(storageDir, { recursive: true });

      const jsonString = JSON.stringify(this.messageHistory, null, kIsDev ? 2 : 0);

      await writeFile(
        this.filePath,
        jsonString,
        'utf-8'
      );
    } catch (error) {
      console.error(`${this.logPrefix} Failed to save message history: ${error}`);
    }
  }

  /**
   * Save message history immediately (for shutdown)
   */
  async saveImmediate(): Promise<void> {
    // Cancel any pending throttled save
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    await this.save();
  }

  /**
   * Add messages to history, keeping only the last kMaxMessages messages
   */
  add(messages: ChatMessage[]): void {
    // Add new messages to history
    this.messageHistory.push(...messages);

    // Sort by timestamp
    this.messageHistory.sort((a, b) => a.timestamp - b.timestamp);

    // Keep only the last kMaxMessages messages
    if (this.messageHistory.length > kMaxHistoryMessages) {
      this.messageHistory = this.messageHistory.slice(-kMaxHistoryMessages);
    }

    // Schedule save (throttled)
    this.scheduleSave();
  }

  /**
   * Get all messages
   */
  getAll(): ChatMessage[] {
    return this.messageHistory;
  }

  /**
   * Get messages filtered by deleted IDs
   */
  getFiltered(deletedIds: string[]): ChatMessage[] {
    const deletedSet = new Set(deletedIds);
    return this.messageHistory.filter(msg => !deletedSet.has(msg.id));
  }

  /**
   * Remove messages by IDs
   */
  removeByIds(ids: string[]): void {
    const idsSet = new Set(ids);
    this.messageHistory = this.messageHistory.filter(msg => !idsSet.has(msg.id));
    this.scheduleSave();
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.messageHistory = [];
    this.scheduleSave();
  }
}

