import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';

import chalk from 'chalk';
// uWebSockets.js is server-only, so client sockets use the 'ws' package.
import WebSocket from 'ws';

import type { ChatMessage, KickServiceConfig, Platform } from '@shared/shared-types.js';
import type { PlatformService, PlatformServiceEvents, PlatformWithConfig } from '@/types.js';

const execFileAsync = promisify(execFile);

const KICK_ORIGIN = 'https://kick.com';
const KICK_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const KICK_REALTIME = 'https://web.kick.com/api/v1/realtime';
const KICK_CHANNEL_API = 'https://kick.com/api/v2/channels';

const CHAT_EVENT = 'App\\Events\\ChatMessageEvent';

interface KickBadge {
  type: string
  text: string
  count?: number
}

interface KickSender {
  id: number
  username: string
  slug: string
  identity?: {
    color?: string
    badges?: KickBadge[]
  }
}

interface KickChatMessageEvent {
  id: string
  chatroom_id: number
  content: string
  type: string
  created_at: string
  sender: KickSender
  metadata?: {
    message_ref?: string
    original_message?: {
      id?: string
    }
  }
  thread_parent_id?: string
}

interface KickTarget {
  channelId: number | null
  chatroomId: number
}

type CommandKind = 'connect' | 'subscribe' | 'refresh';

/**
 * Watches a Kick chatroom.
 *
 * Kick dropped the public Pusher app in October 2026. Chat is now a
 * Centrifugo socket at realtime.*.platform.kick.com: a guest token, then
 * the same chatrooms.{id}.v2 feed as before.
 */
export class KickService extends EventEmitter<PlatformServiceEvents> implements PlatformService {
  public readonly platform: Platform;
  private active: boolean = false;
  private readonly config: KickServiceConfig;
  private logPrefix: string;

  private target: KickTarget | null = null;
  private clientId: string = '';
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private terminalStreak: number = 0;
  private reconnectDelay: number = 1000;
  private isStopping: boolean = false;
  private shouldReconnect: boolean = false;
  private connectGeneration: number = 0;
  private nextCommandId: number = 0;
  private pending = new Map<number, CommandKind>();
  private pingIntervalMs: number = 25_000;
  private lastTrafficAt: number = 0;

  constructor(platformConfig: PlatformWithConfig) {
    super();

    this.platform = {
      id: platformConfig.id,
      name: platformConfig.name,
      color: platformConfig.color,
      abbr: platformConfig.abbr
    };

    this.config = platformConfig.config as KickServiceConfig;
    this.logPrefix = chalk.hex(this.platform.color)(`[${this.platform.abbr}]`);
  }

  isActive(): boolean {
    return this.active;
  }

  private setActive(active: boolean): void {
    if (this.active !== active) {
      this.active = active;
      this.emit('status', active);
    }
  }

  async start(): Promise<void> {
    if (this.shouldReconnect) {
      return;
    }

    console.log(`${this.logPrefix} Starting service for channel: ${this.config.channel}`);

    this.isStopping = false;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this.terminalStreak = 0;
    this.clientId = randomUUID();

    try {
      await this.resolveTarget();
    } catch (error) {
      this.failOrRetry(error);
      return;
    }

    await this.connectWebSocket();
  }

  async stop(): Promise<void> {
    if (!this.shouldReconnect && !this.ws) {
      return;
    }

    console.log(`${this.logPrefix} Stopping service for ${this.config.channel}`);

    this.isStopping = true;
    this.shouldReconnect = false;
    this.connectGeneration++;
    this.setActive(false);
    this.clearTimers();
    this.closeSocket();

    console.log(`${this.logPrefix} Stopped watching ${this.config.channel}`);
  }

  /**
   * A numeric config value is a chatroom id (the old Pusher channel).
   * Anything else is a channel slug, resolved to a chatroom id.
   */
  private async resolveTarget(): Promise<void> {
    const channel = this.config.channel.trim();
    const numericId = /^\d{1,15}$/.test(channel) ? Number(channel) : NaN;

    if (Number.isSafeInteger(numericId) && numericId > 0) {
      this.target = { channelId: null, chatroomId: numericId };
      console.log(`${this.logPrefix} Using chatroom ID: ${numericId}`);
      return;
    }

    if (!/^[A-Za-z0-9_]{1,25}$/.test(channel)) {
      throw new Error(`Invalid Kick channel "${channel}"`);
    }

    const info = await this.fetchChannel(channel);
    this.target = info;
    console.log(`${this.logPrefix} Using chatroom ID: ${info.chatroomId} (channel ${info.channelId})`);
  }

  private async fetchChannel(slug: string): Promise<KickTarget> {
    const url = `${KICK_CHANNEL_API}/${slug}`;
    let payload: unknown;

    try {
      payload = await this.requestJson(url);
    } catch (error) {
      const status = error instanceof KickRequestError ? error.status : 0;

      // kick.com sits behind Cloudflare, which rejects Node's TLS fingerprint.
      // curl's fingerprint is accepted, including the curl in the Docker image.
      if (status === 403 || status === 429 || status === 0) {
        console.log(`${this.logPrefix} Channel lookup was blocked, retrying with curl`);
        payload = await this.requestJsonViaCurl(url);
      } else {
        throw error;
      }
    }

    return parseChannel(slug, payload);
  }

  private async negotiateSocketUrl(): Promise<string> {
    if (!this.target) {
      throw new Error('Kick chatroom is not resolved');
    }

    const path = this.target.channelId
      ? `/channels/${this.target.channelId}/chat/connection`
      : '/connection';

    const payload = await this.requestJson(`${KICK_REALTIME}${path}`, {
      method: 'POST',
      body: {
        client: { id: this.clientId, type: 'web' },
        capabilities: { accepted_providers: [{ provider: 'centrifugo' }] }
      }
    });

    return readSocketUrl(payload);
  }

  private async fetchGuestToken(): Promise<string> {
    const payload = await this.requestJson(`${KICK_REALTIME}/auth/connection`, {
      method: 'POST',
      body: { client_id: this.clientId }
    });

    return readToken(payload);
  }

  private async connectWebSocket(): Promise<void> {
    if (this.isStopping || !this.shouldReconnect) {
      return;
    }

    const generation = ++this.connectGeneration;
    this.clearWatchdogs();
    this.closeSocket();
    this.pending.clear();
    this.nextCommandId = 0;

    try {
      if (!this.target) {
        await this.resolveTarget();
      }

      if (generation !== this.connectGeneration || this.isStopping) {
        return;
      }

      console.log(`${this.logPrefix} Connecting to Kick chat...`);

      const url = await this.negotiateSocketUrl();
      const token = await this.fetchGuestToken();

      if (generation !== this.connectGeneration || this.isStopping) {
        return;
      }

      this.openSocket(url, token, generation);
    } catch (error) {
      if (generation !== this.connectGeneration || this.isStopping) {
        return;
      }

      this.failOrRetry(error);
    }
  }

  private openSocket(url: string, token: string, generation: number): void {
    this.ws = new WebSocket(url, {
      headers: {
        Origin: KICK_ORIGIN,
        'User-Agent': KICK_USER_AGENT
      }
    });

    this.ws.on('open', () => {
      if (generation !== this.connectGeneration) {
        return;
      }

      console.log(`${this.logPrefix} Connected`);
      this.noteTraffic();
      this.sendCommand('connect', { token, name: 'js' });
    });

    this.ws.on('message', (data: Buffer | string) => {
      if (generation !== this.connectGeneration) {
        return;
      }

      this.noteTraffic();
      const text = Buffer.isBuffer(data) ? data.toString('utf-8') : data;
      this.handleFrame(text);
    });

    this.ws.on('error', (error: Error) => {
      if (generation !== this.connectGeneration) {
        return;
      }

      console.error(`${this.logPrefix} WebSocket error:`, error.message);
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      if (generation !== this.connectGeneration) {
        return;
      }

      const why = reason?.toString() || 'no reason';
      console.log(`${this.logPrefix} WebSocket closed (${code}: ${why})`);
      this.setActive(false);
      this.clearWatchdogs();
      this.scheduleReconnect(isTerminalClose(code));
    });
  }

  private sendCommand(kind: CommandKind, payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.nextCommandId += 1;
    this.pending.set(this.nextCommandId, kind);
    this.ws.send(JSON.stringify({ id: this.nextCommandId, [kind]: payload }));
  }

  private handleFrame(text: string): void {
    for (const line of text.split('\n')) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      if (trimmed === '{}') {
        this.ws?.send('{}');
        continue;
      }

      let message: Record<string, unknown>;

      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object') {
          continue;
        }
        message = parsed as Record<string, unknown>;
      } catch (error) {
        console.error(`${this.logPrefix} Error parsing frame:`, error);
        continue;
      }

      const id = typeof message.id === 'number' ? message.id : 0;

      if (id > 0) {
        this.handleReply(id, message);
        continue;
      }

      if (message.push && typeof message.push === 'object') {
        this.handlePush(message.push as Record<string, unknown>);
      }
    }
  }

  private handleReply(id: number, message: Record<string, unknown>): void {
    const kind = this.pending.get(id);
    this.pending.delete(id);

    if (!kind) {
      return;
    }

    const error = readCommandError(message.error);

    if (kind === 'connect') {
      if (error) {
        console.error(`${this.logPrefix} Kick refused the connection: ${error.code} ${error.message}`);
        this.forceClose(isTerminalCommandError(error));
        return;
      }

      const connect = message.connect && typeof message.connect === 'object'
        ? message.connect as Record<string, unknown>
        : {};

      this.pingIntervalMs = readPingMs(connect.ping);
      this.scheduleTokenRefresh(connect);
      this.subscribeToChat();
      return;
    }

    if (kind === 'subscribe') {
      if (error) {
        console.error(`${this.logPrefix} Kick refused the chat subscription: ${error.code} ${error.message}`);
        this.forceClose(isTerminalCommandError(error));
        return;
      }

      this.reconnectAttempts = 0;
      this.terminalStreak = 0;
      this.setActive(true);
      console.log(`${this.logPrefix} Subscribed to chatrooms.${this.target?.chatroomId}.v2`);
      return;
    }

    if (error) {
      console.error(`${this.logPrefix} Kick refused the token refresh: ${error.code} ${error.message}`);

      if (isTerminalCommandError(error)) {
        this.forceClose(true);
      }
      return;
    }

    const refresh = message.refresh && typeof message.refresh === 'object'
      ? message.refresh as Record<string, unknown>
      : {};
    this.scheduleTokenRefresh(refresh);
  }

  private subscribeToChat(): void {
    if (!this.target) {
      return;
    }

    this.sendCommand('subscribe', { channel: `chatrooms.${this.target.chatroomId}.v2` });
  }

  private handlePush(push: Record<string, unknown>): void {
    if (push.disconnect && typeof push.disconnect === 'object') {
      const disconnect = push.disconnect as Record<string, unknown>;
      const code = typeof disconnect.code === 'number' ? disconnect.code : 0;
      console.log(`${this.logPrefix} Kick disconnected (${code})`);
      this.forceClose(isTerminalClose(code));
      return;
    }

    if (push.unsub && typeof push.unsub === 'object') {
      const unsub = push.unsub as Record<string, unknown>;
      const code = typeof unsub.code === 'number' ? unsub.code : 0;

      if (code >= 2500 && code < 3000) {
        this.subscribeToChat();
      }
      return;
    }

    const publication = push.pub && typeof push.pub === 'object'
      ? push.pub as Record<string, unknown>
      : null;
    const envelope = publication?.data && typeof publication.data === 'object'
      ? publication.data as Record<string, unknown>
      : null;

    if (!envelope || envelope.event !== CHAT_EVENT) {
      return;
    }

    try {
      const chatData = decodeChatMessage(envelope.data);
      if (chatData) {
        this.processChatMessage(chatData);
      }
    } catch (error) {
      console.error(`${this.logPrefix} Error parsing chat message:`, error);
    }
  }

  private parseEmotes(content: string): Record<string, string> {
    const emotesMap: Record<string, string> = {};
    const emoteRegex = /\[emote:(\d+):[^\]]+\]/g;
    let match: RegExpExecArray | null = null;

    while ((match = emoteRegex.exec(content)) !== null) {
      const fullEmote = match[0];
      const emoteId = match[1];

      if (emoteId && !emotesMap[fullEmote]) {
        emotesMap[fullEmote] = `https://files.kick.com/emotes/${emoteId}/fullsize`;
      }
    }

    return emotesMap;
  }

  private processChatMessage(data: KickChatMessageEvent): void {
    if (!data.id || !data.sender?.username || !data.content) {
      return;
    }

    const emotesMap = this.parseEmotes(data.content);
    const parsedTime = Date.parse(data.created_at);
    const parentId = data.metadata?.original_message?.id || data.thread_parent_id;

    const chatMessage: ChatMessage = {
      id: `kick-${data.id}`,
      platform: this.platform,
      channel: this.config.channel,
      username: data.sender.username,
      message: data.content,
      emotesMap: Object.keys(emotesMap).length > 0 ? emotesMap : undefined,
      timestamp: Number.isFinite(parsedTime) ? parsedTime : Date.now(),
      color: data.sender.identity?.color || undefined,
      badges: data.sender.identity?.badges?.map(badge => badge.type) || [],
      replyToId: parentId ? `kick-${parentId}` : undefined,
      metadata: {
        userId: data.sender.id,
        chatroomId: data.chatroom_id,
        slug: data.sender.slug,
        badges: data.sender.identity?.badges || [],
        messageRef: data.metadata?.message_ref,
      },
    };

    this.emit('messageUpdated', chatMessage);
  }

  private scheduleTokenRefresh(reply: Record<string, unknown>): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (reply.expires !== true || typeof reply.ttl !== 'number' || reply.ttl <= 0) {
      return;
    }

    const ttlMs = Math.min(Math.max(reply.ttl, 1), 86_400) * 1000;
    const leadMs = Math.min(120_000, Math.floor(ttlMs / 2));
    const delay = Math.max(ttlMs - leadMs, 1000);

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshToken().catch(error => {
        console.error(`${this.logPrefix} Error refreshing Kick token:`, error);
      });
    }, delay);
  }

  private async refreshToken(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.isStopping) {
      return;
    }

    const token = await this.fetchGuestToken();
    this.sendCommand('refresh', { token });
  }

  private noteTraffic(): void {
    this.lastTrafficAt = Date.now();
    this.armSilenceTimer();
  }

  private armSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }

    const limit = this.pingIntervalMs + 20_000;

    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;

      if (this.isStopping || !this.shouldReconnect) {
        return;
      }

      if (Date.now() - this.lastTrafficAt < limit - 250) {
        this.armSilenceTimer();
        return;
      }

      console.log(`${this.logPrefix} Kick went quiet, reconnecting`);
      this.forceClose(false);
    }, limit);
  }

  private forceClose(terminal: boolean): void {
    this.connectGeneration++;
    this.setActive(false);
    this.clearWatchdogs();
    this.closeSocket();
    this.scheduleReconnect(terminal);
  }

  private failOrRetry(error: unknown): void {
    console.error(`${this.logPrefix} Error connecting:`, error);
    this.setActive(false);

    if (isPermanentKickError(error)) {
      this.shouldReconnect = false;
      console.error(`${this.logPrefix} Stopping. Check the Kick channel in config.json.`);
      return;
    }

    this.scheduleReconnect(false);
  }

  private scheduleReconnect(terminal: boolean): void {
    if (this.isStopping || !this.shouldReconnect || this.reconnectTimer) {
      return;
    }

    const delay = terminal
      ? Math.min(300_000 * Math.pow(2, this.terminalStreak), 1_800_000)
      : Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 60_000);

    if (terminal) {
      this.terminalStreak++;
    } else {
      this.reconnectAttempts++;
    }

    console.log(`${this.logPrefix} Reconnecting in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;

      if (this.isStopping || !this.shouldReconnect) {
        return;
      }

      if (terminal) {
        this.clientId = randomUUID();
        this.target = null;
      }

      this.connectWebSocket().catch(error => {
        console.error(`${this.logPrefix} Reconnection failed:`, error);
      });
    }, delay);
  }

  private clearWatchdogs(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearWatchdogs();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(): void {
    const socket = this.ws;
    this.ws = null;

    if (!socket) {
      return;
    }

    try {
      socket.removeAllListeners();

      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    } catch {
      // Ignore errors during cleanup.
    }
  }

  private async requestJson(url: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
    const response = await fetch(url, {
      method: init?.method ?? 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: KICK_ORIGIN,
        Referer: `${KICK_ORIGIN}/`,
        'User-Agent': KICK_USER_AGENT,
        'x-app-platform': 'web'
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body)
    });

    if (response.status < 200 || response.status >= 300) {
      throw new KickRequestError(response.status, response.statusText);
    }

    return response.json() as Promise<unknown>;
  }

  private async requestJsonViaCurl(url: string): Promise<unknown> {
    let stdout: string;

    try {
      const result = await execFileAsync('curl', [
        '-sS',
        '-A', KICK_USER_AGENT,
        '-H', 'Accept: application/json',
        '-H', `Origin: ${KICK_ORIGIN}`,
        '-H', `Referer: ${KICK_ORIGIN}/`,
        '-w', '\n%{http_code}',
        '--max-time', '20',
        url
      ], {
        encoding: 'utf8',
        maxBuffer: 2_000_000,
        windowsHide: true
      });

      stdout = result.stdout;
    } catch (error) {
      const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
      throw new Error(missing
        ? 'Kick blocked the channel lookup and curl is not installed'
        : 'Kick channel lookup via curl failed');
    }

    const splitAt = stdout.lastIndexOf('\n');
    const status = Number(stdout.slice(splitAt + 1).trim());
    const body = splitAt >= 0 ? stdout.slice(0, splitAt) : stdout;

    if (status < 200 || status >= 300) {
      throw new KickRequestError(status, `curl HTTP ${status}`);
    }

    return JSON.parse(body) as unknown;
  }
}

class KickRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`HTTP ${status}: ${message}`);
    this.name = 'KickRequestError';
  }
}

function parseChannel(slug: string, payload: unknown): KickTarget {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`Kick channel ${slug} response was not an object`);
  }

  const record = payload as { id?: unknown; chatroom?: { id?: unknown } };
  const channelId = record.id;
  const chatroomId = record.chatroom?.id;

  if (typeof channelId !== 'number' || typeof chatroomId !== 'number' || channelId <= 0 || chatroomId <= 0) {
    throw new Error(`Kick channel ${slug} did not include a chatroom id`);
  }

  return { channelId, chatroomId };
}

function readSocketUrl(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Kick realtime response was not an object');
  }

  const data = (payload as { data?: { connections?: unknown } }).data;
  const connections = Array.isArray(data?.connections) ? data.connections : [];

  for (const item of connections) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const connection = item as { provider?: unknown; credentials?: { url?: unknown } };
    const url = connection.credentials?.url;

    if (connection.provider === 'centrifugo' && typeof url === 'string' && isKickSocketUrl(url)) {
      return url;
    }
  }

  throw new Error('Kick did not offer a chat socket');
}

function isKickSocketUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'wss:'
      && parsed.hostname.endsWith('.platform.kick.com')
      && parsed.pathname === '/connection/websocket';
  } catch {
    return false;
  }
}

function readToken(payload: unknown): string {
  const token = payload && typeof payload === 'object'
    ? (payload as { data?: { token?: unknown } }).data?.token
    : undefined;

  if (typeof token !== 'string' || token.length < 8) {
    throw new Error('Kick did not return a guest token');
  }

  return token;
}

function readPingMs(ping: unknown): number {
  if (typeof ping !== 'number' || ping <= 0) {
    return 25_000;
  }

  return Math.min(Math.max(ping, 1), 600) * 1000;
}

function readCommandError(error: unknown): { code: number; message: string; temporary: boolean } | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const record = error as { code?: unknown; message?: unknown; temporary?: unknown };

  return {
    code: typeof record.code === 'number' ? record.code : 0,
    message: typeof record.message === 'string' ? record.message : '',
    temporary: record.temporary === true
  };
}

function isTerminalCommandError(error: { code: number; temporary: boolean }): boolean {
  return error.code >= 100 && !error.temporary && error.code !== 109;
}

function isPermanentKickError(error: unknown): boolean {
  if (error instanceof KickRequestError && (error.status === 400 || error.status === 404)) {
    return true;
  }

  return error instanceof Error && error.message.startsWith('Invalid Kick channel');
}

function isTerminalClose(code: number): boolean {
  return (code >= 3500 && code <= 3999) || (code >= 4500 && code <= 4999);
}

function decodeChatMessage(data: unknown): KickChatMessageEvent | null {
  let value = data;

  if (typeof value === 'string') {
    value = JSON.parse(value) as unknown;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as KickChatMessageEvent;
}
