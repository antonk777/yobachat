import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import { dirname } from 'path';
import chalk from 'chalk';

import type { TelegramVideoItem } from '@shared/shared-types.js';
import { storageFile } from '@/storage-path.js';

const kMaxPendingVideos = 10;

type QueuePersistedState = {
  pending: TelegramVideoItem[];
  approved: TelegramVideoItem | null;
};

/**
 * Moderation queue for Telegram videos/GIFs destined for the OBS overlay.
 */
export class TelegramVideoQueueService {
  public logPrefix = chalk.blue('[TgVideoQueue]');

  private pending: TelegramVideoItem[] = [];
  private approved: TelegramVideoItem | null = null;
  private rejectedFileIds = new Set<string>();
  private nextId = 1;
  private filePath = storageFile('telegram-videos.json');

  async init(): Promise<void> {
    await this.load();

    // After restart, require re-approval (same as tg-vid-bot)
    if (this.approved) {
      const alreadyPending = this.pending.some(v => v.fileId === this.approved!.fileId);

      if (!alreadyPending && !this.rejectedFileIds.has(this.approved.fileId)) {
        this.pending.push({
          ...this.approved,
          id: this.nextId++,
          pendingDate: new Date().toISOString(),
        });
        this.limitPending();
        console.log(`${this.logPrefix} Moved previous approved video back to pending`);
      }

      this.approved = null;
      await this.save();
    }
  }

  getPending(): TelegramVideoItem[] {
    return [...this.pending];
  }

  getApproved(): TelegramVideoItem | null {
    return this.approved;
  }

  enqueue(video: Omit<TelegramVideoItem, 'id' | 'pendingDate'>): TelegramVideoItem | null {
    if (this.rejectedFileIds.has(video.fileId)) {
      return null;
    }

    if (this.pending.some(v => v.fileId === video.fileId)) {
      return null;
    }

    const item: TelegramVideoItem = {
      ...video,
      id: this.nextId++,
      pendingDate: new Date().toISOString(),
    };

    this.pending.push(item);
    this.limitPending();
    void this.save();

    return item;
  }

  approve(id: number): TelegramVideoItem | null {
    const index = this.pending.findIndex(v => v.id === id);

    if (index === -1) {
      return null;
    }

    const [video] = this.pending.splice(index, 1);
    this.approved = video;
    void this.save();

    return video;
  }

  reject(id: number): TelegramVideoItem | null {
    const index = this.pending.findIndex(v => v.id === id);

    if (index === -1) {
      return null;
    }

    const [video] = this.pending.splice(index, 1);
    this.rejectedFileIds.add(video.fileId);
    void this.save();

    return video;
  }

  private limitPending(): void {
    if (this.pending.length <= kMaxPendingVideos) {
      return;
    }

    this.pending.sort((a, b) => {
      const aDate = a.pendingDate ? Date.parse(a.pendingDate) : 0;
      const bDate = b.pendingDate ? Date.parse(b.pendingDate) : 0;
      return bDate - aDate;
    });
    this.pending = this.pending.slice(0, kMaxPendingVideos);
  }

  private async load(): Promise<void> {
    try {
      await access(this.filePath, constants.F_OK);
    } catch {
      return;
    }

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(content) as QueuePersistedState;

      this.pending = Array.isArray(parsed.pending) ? parsed.pending : [];
      this.approved = parsed.approved ?? null;
      this.limitPending();

      const maxId = this.pending.reduce((max, v) => Math.max(max, v.id), 0);
      this.nextId = maxId + 1;
    } catch (error) {
      console.warn(`${this.logPrefix} Failed to load queue: ${error}`);
      this.pending = [];
      this.approved = null;
    }
  }

  private async save(): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });

      const state: QueuePersistedState = {
        pending: this.pending,
        approved: this.approved,
      };

      await writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (error) {
      console.error(`${this.logPrefix} Failed to save queue: ${error}`);
    }
  }
}
