import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import { dirname } from 'path';
import { MessageIdSchema } from '@/validation';
import { storageFile } from '@/storage-path.js';

/**
 * Service for managing deleted message IDs
 */
export class DeletedMessagesService {
  private ids: Set<string> = new Set();
  private filePath: string;

  constructor() {
    this.filePath = storageFile('deleted-messages.json');
  }

  /**
   * Initialize the service by loading deleted messages from disk
   */
  async init(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      await access(this.filePath, constants.F_OK);
    } catch {
      // File doesn't exist, initialize with empty array and save it
      this.ids = new Set();
      await this.save();
      return;
    }

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(content) as string[];

      // Validate all IDs before loading
      const validIds = parsed
        .filter(id => typeof id === 'string')
        .map(id => MessageIdSchema.parse(id))
        .filter((id): id is string => id !== null);

      this.ids = new Set(validIds);
    } catch (error) {
      console.warn(`[DeletedMessagesService] Failed to load deleted messages: ${error}`);
      this.ids = new Set();
    }
  }

  private async save(): Promise<void> {
    try {
      // Ensure the storage directory exists
      const storageDir = dirname(this.filePath);
      await mkdir(storageDir, { recursive: true });

      const idsArr = Array.from(this.ids);
      await writeFile(this.filePath, JSON.stringify(idsArr, null, 2), 'utf-8');
    } catch (error) {
      console.error(`[DeletedMessagesService] Failed to save deleted messages: ${error}`);
    }
  }

  async add(ids: string[]): Promise<void> {
    // Validate and sanitize the ID before adding
    const validIds = ids
      .filter(id => typeof id === 'string')
      .map(id => MessageIdSchema.safeParse(id))
      .filter(result => result.success)
      .map(result => result.data);

    for (const id of validIds) {
      this.ids.add(id);
    }

    await this.save();
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  getAll(): string[] {
    return Array.from(this.ids);
  }

  async set(ids: string[]): Promise<void> {
    // Validate all IDs before setting
    const validIds = ids
      .filter(id => typeof id === 'string')
      .map(id => MessageIdSchema.parse(id))
      .filter((id): id is string => id !== null);

    this.ids = new Set(validIds);
    await this.save();
  }
}

