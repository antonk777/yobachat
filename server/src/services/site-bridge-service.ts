import WebSocket from 'ws';
import chalk from 'chalk';

import type { ChatMessage, Platform } from '@shared/shared-types.js';
import {
  chatBridgeSocketUrl,
  type BridgeEvent,
  type SiteEmote,
  type SiteEmoteFile,
} from 'yobachat-shared';

import { ChatMessageSchema } from '@/validation.js';

export const kSitePlatform: Platform = {
  id: 'site',
  name: 'Site',
  color: '#be4ad4',
  abbr: 'WEB',
};

export interface SiteBridgeConfig {
  origin: string;
  token: string;
}

interface SiteBridgeHandlers {
  getHistory: () => ChatMessage[];
  onSiteMessage: (message: ChatMessage) => void;
  onEmoteQueue: (emotes: SiteEmote[]) => void;
}

const kMinRetryMs = 1000;
const kMaxRetryMs = 5000;
const kConnectTimeoutMs = 5000;
const kHeartbeatMs = 10000;

export class SiteBridgeService {
  private readonly logPrefix = chalk.cyan('[SiteBridge]');
  private socket: WebSocket | null = null;
  private stopped = false;
  private retryMs = kMinRetryMs;
  private retryTimer: NodeJS.Timeout | null = null;
  private beatTimer: NodeJS.Timeout | null = null;
  private waitingPong = false;

  constructor(
    private readonly config: SiteBridgeConfig,
    private readonly handlers: SiteBridgeHandlers,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    this.clearHeartbeat();
    this.socket?.close();
    this.socket = null;
  }

  sendMessages(messages: ChatMessage[]): void {
    if (messages.length === 0) {
      return;
    }

    this.send({ type: 'messages', messages });
  }

  sendDeleted(ids: string[]): void {
    if (ids.length === 0) {
      return;
    }

    this.send({ type: 'deleted', ids });
  }

  sendClear(): void {
    this.send({ type: 'clear' });
  }

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  sendEmoteReview(id: string, action: 'approve' | 'reject'): void {
    this.send({ type: 'emote-review', id, action });
  }

  sendEmoteAdd(files: SiteEmoteFile[]): void {
    this.send({ type: 'emote-add', files });
  }

  sendEmoteRename(id: string, name: string): void {
    this.send({ type: 'emote-rename', id, name });
  }

  sendEmoteDelete(id: string): void {
    this.send({ type: 'emote-delete', id });
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }

    const url = new URL(chatBridgeSocketUrl(this.config.origin));
    url.searchParams.set('token', this.config.token);

    const socket = new WebSocket(url);
    this.socket = socket;
    const failTimer = setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN) {
        return;
      }

      console.error(`${this.logPrefix} Timed out opening ${url.host}`);
      socket.terminate();
    }, kConnectTimeoutMs);

    socket.on('open', () => {
      clearTimeout(failTimer);
      this.retryMs = kMinRetryMs;
      this.waitingPong = false;
      this.armHeartbeat(socket);
      console.log(`${this.logPrefix} Connected`);
      this.send({
        type: 'hello',
        messages: this.handlers.getHistory(),
        siteAcks: true,
      });
    });

    socket.on('message', (data) => {
      this.handleMessage(typeof data === 'string' ? data : data.toString());
    });

    socket.on('close', (code) => {
      clearTimeout(failTimer);
      this.clearHeartbeat();

      if (this.socket === socket) {
        this.socket = null;
      }

      console.warn(`${this.logPrefix} Closed (${code})`);
      this.scheduleReconnect();
    });

    socket.on('error', (error) => {
      console.error(`${this.logPrefix} ${error.message}`);
    });
  }

  private armHeartbeat(socket: WebSocket): void {
    this.clearHeartbeat();
    this.beatTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      if (this.waitingPong) {
        console.warn(`${this.logPrefix} Site did not answer`);
        socket.terminate();
        return;
      }

      this.waitingPong = true;
      socket.send(JSON.stringify({ type: 'ping' }));
    }, kHeartbeatMs);
  }

  private clearHeartbeat(): void {
    if (this.beatTimer) {
      clearInterval(this.beatTimer);
      this.beatTimer = null;
    }

    this.waitingPong = false;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer) {
      return;
    }

    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, kMaxRetryMs);

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private send(event: BridgeEvent): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(event));
  }

  private handleMessage(raw: string): void {
    let parsed: BridgeEvent;

    try {
      parsed = JSON.parse(raw) as BridgeEvent;
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
      return;
    }

    if ((parsed as { type?: string }).type === 'pong') {
      this.waitingPong = false;
      return;
    }

    if (parsed.type === 'emote-queue' && Array.isArray(parsed.emotes)) {
      this.handlers.onEmoteQueue(parsed.emotes);
      return;
    }

    if (parsed.type !== 'site-message') {
      return;
    }

    const result = ChatMessageSchema.safeParse(parsed.message);

    if (!result.success || result.data.platform.id !== 'site') {
      console.warn(`${this.logPrefix} Rejected site message`);
      const id = (parsed.message as { id?: unknown } | null)?.id;

      if (typeof id === 'string') {
        this.send({ type: 'site-ack', ids: [], rejected: [id] });
      }

      return;
    }

    this.handlers.onSiteMessage(result.data);
    this.send({ type: 'site-ack', ids: [result.data.id] });
  }
}
