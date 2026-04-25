/**
 * Twitch EventSub **webhook** transport — experimental parallel to twitch-service.ts (IRC).
 *
 * Twitch POSTs HTTPS notifications to your public callback URL. This service registers
 * an HTTP handler (same pattern as Telegram webhooks), verifies `Twitch-Eventsub-*`
 * signatures using the subscription secret, and maps `channel.chat.message` events
 * into `ChatMessage` + `messageUpdated`.
 *
 * Prerequisites:
 *  - `admin.twitchOAuth` client id + secret — used for **app access token** (Helix EventSub subscribe/delete, `/users` lookup).
 *  - Allowlisted admin visits `/auth/twitch/login` — OAuth user becomes `condition.user_id`; scopes must include
 *    `user:read:chat` and `user:bot`. The broadcaster must have linked the bot via `channel:bot`, or the OAuth user
 *    must be the broadcaster, or a moderator of the channel (Twitch authorization rules).
 *  - Public HTTPS URL reachable by Twitch (nginx → webhook port), same as other webhooks.
 *  - `webhookSecret` in `twitch` config: 10–100 ASCII chars for Helix + HMAC verification.
 *
 * Wiring (same idea as `TelegramService`):
 *  - Pass `webhookUrl` like `https://${apiHost}${basePath}${webhookPath}` from server config.
 *  - Pass `registerHandler` / `unregisterHandler` from `ChatServer`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import chalk from 'chalk';

import type { Request, Response } from 'express';
import type { ChatMessage, Platform } from '@shared/shared-types.js';
import type { PlatformService, PlatformServiceEvents, WebhookHandler } from '@/types.js';
import type { RequestWithRawBody } from '@/services/webhook-service.js';

import {
  kTwitchBadgeMapping,
  kSubGifterBadgeMapping,
  kBitsBadgeMapping,
} from '@/constants/twitch.js';


// ─── Config ───────────────────────────────────────────────────────────────────

export interface TwitchEventSubServiceConfig {
  channelId: string;
  /** From `admin.twitchOAuth.clientId` — Twitch application id. */
  clientId: string;
  /** From `admin.twitchOAuth.clientSecret` — client credentials flow for Helix (EventSub API requires app token). */
  clientSecret: string;
  /**
   * OAuth user access token from `AuthService` (persisted file + refresh). Used only to confirm a chat session exists;
   * Helix calls use an app access token from client id + secret.
   */
  getAccessToken: () => Promise<string | null>;
  /** Numeric user id for the same OAuth session (EventSub subscription `condition.user_id`). */
  getUserId: () => Promise<string | null>;
  /** Validates the chat token and returns scopes (EventSub diagnostics). */
  getChatOAuthTokenInfo: () => Promise<{
    login: string;
    user_id: string;
    scopes: string[];
  } | null>;
  /**
   * Secret passed to Helix when creating the subscription (10–100 ASCII characters).
   * Twitch uses it for `Twitch-Eventsub-Message-Signature` HMAC verification.
   */
  webhookSecret: string;
}

/** Same pattern as `TelegramService` webhook options. */
export interface TwitchEventSubWebhookOptions {
  registerHandler: (path: string, handler: WebhookHandler) => void;
  unregisterHandler: (path: string) => void;
  /**
   * Base URL from server config: `https://${apiHost}${basePath}${webhookPath}`
   * (e.g. ends with `/webhook/`). Handler path is appended after stripping a trailing `/webhook`.
   */
  webhookUrl: string;
}


// ─── Event payload types (channel.chat.message) ─────────────────────────────────

interface ESChatFragment {
  type: 'text' | 'cheermote' | 'emote' | 'mention';
  text: string;
  cheermote?: { prefix: string; bits: number; tier: number };
  emote?: {
    id: string;
    emote_set_id: string;
    owner_id: string;
    format: string[];
  };
  mention?: { user_id: string; user_name: string; user_login: string };
}

interface ESChatBadge {
  set_id: string;
  id: string;
  info: string;
}

interface ESChatReply {
  parent_message_id: string;
  parent_message_body: string;
  parent_user_id: string;
  parent_user_name: string;
  parent_user_login: string;
  thread_message_id: string;
  thread_user_id: string;
}

interface ESChatMessageEvent {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  message_id: string;
  message: {
    text: string;
    fragments: ESChatFragment[];
  };
  message_type: string;
  badges: ESChatBadge[];
  cheer?: { bits: number };
  color: string;
  reply?: ESChatReply;
}

interface EventSubSubscription {
  id: string;
  status: string;
  type: string;
  version: string;
  condition?: {
    broadcaster_user_id?: string;
    user_id?: string;
  };
  transport?: {
    method?: string;
    callback?: string;
  };
}


// ─── Helix ─────────────────────────────────────────────────────────────────────

const kHelixBase = 'https://api.twitch.tv/helix';

async function helixGet<T>(
  path: string,
  clientId: string,
  accessToken: string,
): Promise<T> {
  const res = await fetch(`${kHelixBase}${path}`, {
    headers: {
      'Client-Id': clientId,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Helix GET ${path} failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<T>;
}

async function helixPost(
  path: string,
  body: unknown,
  clientId: string,
  accessToken: string,
): Promise<{ status: number; body: string }> {
  const res = await fetch(`${kHelixBase}${path}`, {
    method: 'POST',
    headers: {
      'Client-Id': clientId,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => '');
  return { status: res.status, body: text };
}

async function helixDelete(
  path: string,
  clientId: string,
  accessToken: string,
): Promise<{ status: number; body: string }> {
  const res = await fetch(`${kHelixBase}${path}`, {
    method: 'DELETE',
    headers: {
      'Client-Id': clientId,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const text = await res.text().catch(() => '');
  return { status: res.status, body: text };
}

// ─── Twitch signature verification ─────────────────────────────────────────────

const HMAC_PREFIX = 'sha256=';

function verifyTwitchSignature(
  secret: string,
  messageId: string,
  timestamp: string,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith(HMAC_PREFIX)) {
    return false;
  }

  const expectedHex = createHmac('sha256', secret)
    .update(messageId)
    .update(timestamp)
    .update(rawBody)
    .digest('hex');

  const expected = `${HMAC_PREFIX}${expectedHex}`;

  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signatureHeader, 'utf8');
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}


// ─── Service ──────────────────────────────────────────────────────────────────

export class TwitchEventSubService
  extends EventEmitter<PlatformServiceEvents>
  implements PlatformService
{
  public readonly platform: Platform;
  private readonly config: TwitchEventSubServiceConfig;
  private readonly logPrefix: string;

  private readonly registerHandler: (path: string, handler: WebhookHandler) => void;
  private readonly unregisterHandler: (path: string) => void;
  private readonly fullCallbackUrl: string;
  private readonly webhookPath: string;

  private active = false;
  private isStopping = false;

  private broadcasterId: string | null = null;
  private subscriptionId: string | null = null;

  /** Client-credentials token for Helix EventSub + `/users` (Twitch rejects user tokens for subscribe). */
  private appAccessTokenCache: { token: string; expiresAt: number } | null = null;
  private static readonly kAppAccessTokenSkewMs = 60_000;

  /** Dedup Twitch retries (same Message-Id). */
  private readonly seenMessageIds = new Set<string>();
  private static readonly kMaxSeenIds = 5000;

  constructor(
    platform: Platform,
    config: TwitchEventSubServiceConfig,
    options: TwitchEventSubWebhookOptions,
  ) {
    super();

    this.platform = platform;
    this.config = config;
    this.logPrefix = chalk.hex(this.platform.color)(`[${this.platform.abbr}/ES]`);

    this.registerHandler = options.registerHandler;
    this.unregisterHandler = options.unregisterHandler;

    const channelSlug = this.config.channelId.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    this.webhookPath = `/webhook/twitch/eventsub/${channelSlug}`;
    const baseUrl = options.webhookUrl.replace(/\/webhook\/?$/, '') || '';
    this.fullCallbackUrl = `${baseUrl}${this.webhookPath}`;
  }

  /**
   * Twitch requires an **app access token** for `POST/DELETE /eventsub/subscriptions` and accepts it for `GET /users`.
   */
  private async ensureAppAccessToken(): Promise<string> {
    const now = Date.now();
    if (
      this.appAccessTokenCache &&
      this.appAccessTokenCache.expiresAt - now > TwitchEventSubService.kAppAccessTokenSkewMs
    ) {
      return this.appAccessTokenCache.token;
    }

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      throw new Error(`Twitch app access token failed: HTTP ${res.status} ${text}`);
    }

    let parsed: { access_token?: string; expires_in?: number };
    try {
      parsed = JSON.parse(text) as { access_token?: string; expires_in?: number };
    } catch {
      throw new Error(`Twitch app access token: invalid JSON ${text}`);
    }

    const access_token = parsed.access_token;
    if (typeof access_token !== 'string' || !access_token) {
      throw new Error('Twitch app access token: missing access_token');
    }

    const expiresInSec =
      typeof parsed.expires_in === 'number' && Number.isFinite(parsed.expires_in)
        ? parsed.expires_in
        : 3600;
    const expiresAt = Date.now() + expiresInSec * 1000;
    this.appAccessTokenCache = { token: access_token, expiresAt };
    return access_token;
  }

  isActive(): boolean {
    return this.active;
  }

  async start(): Promise<void> {
    if (this.active) {
      return;
    }

    this.isStopping = false;

    if (this.config.webhookSecret.length < 10 || this.config.webhookSecret.length > 100) {
      console.error(
        `${this.logPrefix} webhookSecret must be 10–100 ASCII characters (Twitch requirement).`,
      );
      return;
    }

    const oauthToken = await this.config.getAccessToken();
    const oauthUserId = await this.config.getUserId();
    if (!oauthToken || !oauthUserId) {
      console.error(
        `${this.logPrefix} No Twitch OAuth session for EventSub. ` +
          `An allowlisted admin must open /auth/twitch/login once (tokens: storage/twitch-chat-oauth.json).`,
      );
      return;
    }

    const tokenInfo = await this.config.getChatOAuthTokenInfo();
    if (tokenInfo) {
      console.log(
        `${this.logPrefix} OAuth session: login=${tokenInfo.login} user_id=${tokenInfo.user_id} scopes=[${tokenInfo.scopes.join(', ')}]`,
      );
      const requiredScopes = ['user:read:chat', 'user:bot'] as const;
      const missing = requiredScopes.filter((s) => !tokenInfo.scopes.includes(s));
      if (missing.length > 0) {
        console.error(
          `${this.logPrefix} Token is missing scopes: ${missing.join(', ')}. ` +
            `Disconnect the app at twitch.tv/settings/connections and complete /auth/twitch/login again.`,
        );
        return;
      }
    } else {
      console.warn(`${this.logPrefix} Could not validate OAuth token (GET /oauth2/validate); continuing anyway.`);
    }

    if (!this.broadcasterId) {
      try {
        this.broadcasterId = await this.resolveBroadcasterId();
      } catch (err) {
        console.error(`${this.logPrefix} Failed to resolve broadcaster ID:`, err);
        return;
      }
    }

    if (oauthUserId !== this.broadcasterId) {
      console.warn(
        `${this.logPrefix} OAuth user (${oauthUserId}) is not the broadcaster (${this.broadcasterId} / ${this.config.channelId}). ` +
          `Twitch will reject EventSub unless that account is a /mod in this channel, or the broadcaster authorizes channel:bot for your app.`,
      );
    }

    // Register HTTP handler *before* Helix subscription — Twitch will POST verification immediately.
    this.registerHandler(this.webhookPath, (req, res) => this.handleWebhook(req, res));

    try {
      await this.createSubscription();
    } catch (err) {
      console.error(`${this.logPrefix} Failed to create EventSub subscription:`, err);
      this.unregisterHandler(this.webhookPath);
      return;
    }

    console.log(`${this.logPrefix} Webhook listening at ${this.fullCallbackUrl}`);
  }

  async stop(): Promise<void> {
    this.isStopping = true;

    this.unregisterHandler(this.webhookPath);

    if (this.subscriptionId) {
      const id = this.subscriptionId;
      this.subscriptionId = null;
      try {
        const accessToken = await this.ensureAppAccessToken();
        const { status, body } = await helixDelete(
          `/eventsub/subscriptions?id=${encodeURIComponent(id)}`,
          this.config.clientId,
          accessToken,
        );
        if (status === 204 || status === 200) {
          console.log(`${this.logPrefix} Removed EventSub subscription ${id}`);
        } else {
          console.warn(`${this.logPrefix} DELETE subscription returned ${status}: ${body}`);
        }
      } catch (err) {
        console.error(`${this.logPrefix} Error deleting EventSub subscription:`, err);
      }
    }

    this.setActive(false);
    this.seenMessageIds.clear();

    console.log(`${this.logPrefix} Stopped watching ${this.config.channelId}`);
  }

  private handleWebhook(req: Request, res: Response): void {
    const rawBody = (req as RequestWithRawBody).rawBody;
    if (!rawBody) {
      console.error(`${this.logPrefix} Missing rawBody on request (webhook server must use raw-body verify).`);
      res.sendStatus(500);
      return;
    }

    const messageId = req.headers['twitch-eventsub-message-id'];
    const timestamp = req.headers['twitch-eventsub-message-timestamp'];
    const signature = req.headers['twitch-eventsub-message-signature'];
    const messageType = req.headers['twitch-eventsub-message-type'];

    if (typeof messageId !== 'string' || typeof timestamp !== 'string') {
      res.sendStatus(400);
      return;
    }

    if (
      !verifyTwitchSignature(
        this.config.webhookSecret,
        messageId,
        timestamp,
        rawBody,
        typeof signature === 'string' ? signature : undefined,
      )
    ) {
      res.sendStatus(403);
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      res.sendStatus(400);
      return;
    }

    switch (messageType) {
      case 'webhook_callback_verification': {
        const challenge = payload.challenge;
        if (typeof challenge !== 'string') {
          res.sendStatus(400);
          return;
        }
        res.status(200).type('text/plain').send(challenge);
        return;
      }

      case 'notification': {
        if (this.seenMessageIds.has(messageId)) {
          res.sendStatus(200);
          return;
        }
        this.seenMessageIds.add(messageId);
        if (this.seenMessageIds.size > TwitchEventSubService.kMaxSeenIds) {
          this.seenMessageIds.clear();
        }

        const subscription = payload.subscription as { type?: string } | undefined;
        const event = payload.event as ESChatMessageEvent | undefined;

        if (subscription?.type === 'channel.chat.message' && event) {
          this.handleChatMessage(event);
        }

        res.sendStatus(200);
        return;
      }

      case 'revocation': {
        console.error(`${this.logPrefix} Subscription revoked:`, JSON.stringify(payload));
        this.setActive(false);
        res.sendStatus(200);
        return;
      }

      default:
        res.sendStatus(200);
    }
  }

  private async createSubscription(): Promise<void> {
    const oauthUserId = await this.config.getUserId();
    if (!oauthUserId) {
      throw new Error('Missing Twitch OAuth user id');
    }

    const accessToken = await this.ensureAppAccessToken();
    const existingSubscription = await this.findReusableSubscription(
      accessToken,
      oauthUserId,
      this.fullCallbackUrl,
    );
    if (existingSubscription) {
      this.subscriptionId = existingSubscription.id;
      console.log(
        `${this.logPrefix} Reusing EventSub subscription ${existingSubscription.id} (${existingSubscription.status})`,
      );
      this.setActive(true);
      return;
    }

    const body = {
      type: 'channel.chat.message',
      version: '1',
      condition: {
        broadcaster_user_id: this.broadcasterId,
        user_id: oauthUserId,
      },
      transport: {
        method: 'webhook',
        callback: this.fullCallbackUrl,
        secret: this.config.webhookSecret,
      },
    };

    console.log(`${this.logPrefix} Creating EventSub webhook subscription...`);

    const { status, body: responseBody } = await helixPost(
      '/eventsub/subscriptions',
      body,
      this.config.clientId,
      accessToken,
    );

    if (status !== 202) {
      if (status === 403) {
        console.error(
          `${this.logPrefix} Twitch returned 403 for this subscription. ` +
            `Required: OAuth account must have granted user:bot and user:read:chat (re-open /auth/twitch/login after upgrading scopes). ` +
            `Also the OAuth user must match the broadcaster, be a /mod in that channel, or the broadcaster must authorize channel:bot for this app.`,
        );
      }
      if (status === 429) {
        const reusableAfter429 = await this.findReusableSubscription(
          accessToken,
          oauthUserId,
          this.fullCallbackUrl,
        );
        if (reusableAfter429) {
          this.subscriptionId = reusableAfter429.id;
          console.warn(
            `${this.logPrefix} EventSub returned 429, but found existing subscription ${reusableAfter429.id}; continuing.`,
          );
          this.setActive(true);
          return;
        }
      }
      throw new Error(`EventSub subscribe failed: HTTP ${status} ${responseBody}`);
    }

    let parsed: { data?: Array<{ id: string; status: string }> };
    try {
      parsed = JSON.parse(responseBody) as { data?: Array<{ id: string; status: string }> };
    } catch {
      throw new Error(`Invalid JSON from EventSub subscribe: ${responseBody}`);
    }

    const subId = parsed.data?.[0]?.id;
    if (subId) {
      this.subscriptionId = subId;
      console.log(
        `${this.logPrefix} Subscription created (id: ${subId}, status: ${parsed.data?.[0]?.status ?? '?'})`,
      );
    }

    // Enabled only after Twitch completes callback verification (notification flow).
    this.setActive(true);
  }

  private async resolveBroadcasterId(): Promise<string> {
    const accessToken = await this.ensureAppAccessToken();

    const data = await helixGet<{ data: Array<{ id: string; login: string }> }>(
      `/users?login=${encodeURIComponent(this.config.channelId)}`,
      this.config.clientId,
      accessToken,
    );

    const user = data.data?.[0];
    if (!user) {
      throw new Error(`User not found for login: ${this.config.channelId}`);
    }

    console.log(`${this.logPrefix} Resolved "${this.config.channelId}" → user_id ${user.id}`);
    return user.id;
  }

  private async findReusableSubscription(
    accessToken: string,
    oauthUserId: string,
    callbackUrl: string,
  ): Promise<EventSubSubscription | null> {
    const response = await helixGet<{ data?: EventSubSubscription[] }>(
      '/eventsub/subscriptions?type=channel.chat.message',
      this.config.clientId,
      accessToken,
    );

    const subscriptions = response.data ?? [];
    for (const subscription of subscriptions) {
      const isSameCondition =
        subscription.condition?.broadcaster_user_id === this.broadcasterId &&
        subscription.condition?.user_id === oauthUserId;
      const isWebhookMatch = subscription.transport?.callback === callbackUrl;
      if (!isSameCondition || !isWebhookMatch) {
        continue;
      }

      const status = subscription.status;
      if (
        status === 'enabled' ||
        status === 'webhook_callback_verification_pending' ||
        status === 'webhook_callback_verification_failed'
      ) {
        return subscription;
      }
    }

    return null;
  }

  private handleChatMessage(event: ESChatMessageEvent): void {
    const emotesMap = this.parseEmotesFromFragments(event.message.fragments);
    const badgeImages = this.parseBadgeImages(event.badges);

    const messageId = `twitch-${event.message_id}`;

    let messageText = event.message.text;
    let replyToId: string | undefined;

    if (event.reply) {
      replyToId = `twitch-${event.reply.parent_message_id}`;
      const prefix = `@${event.reply.parent_user_name} `;
      if (messageText.startsWith(prefix)) {
        messageText = messageText.slice(prefix.length).trim();
      }
    }

    const badgeNames = event.badges.map((b) => b.set_id);
    const badgeSetIds = new Set(badgeNames);
    const isModerator = badgeSetIds.has('moderator');
    const isVip = badgeSetIds.has('vip');
    const isSubscriber = badgeSetIds.has('subscriber');

    const chatMessage: ChatMessage = {
      id: messageId,
      platform: this.platform,
      channel: event.broadcaster_user_login,
      username: event.chatter_user_name,
      message: messageText,
      timestamp: Date.now(),
      color: event.color || undefined,
      badges: badgeNames,
      badgeImages: Object.keys(badgeImages).length > 0 ? badgeImages : undefined,
      isSubscriber,
      isModerator,
      isVip,
      emotesMap: Object.keys(emotesMap).length > 0 ? emotesMap : undefined,
      replyToId,
    };

    this.emit('messageUpdated', chatMessage);
  }

  private parseEmotesFromFragments(fragments: ESChatFragment[]): Record<string, string> {
    const emotesMap: Record<string, string> = {};

    for (const fragment of fragments) {
      if (fragment.type === 'emote' && fragment.emote) {
        const url = `https://static-cdn.jtvnw.net/emoticons/v2/${fragment.emote.id}/default/dark/2.0`;
        emotesMap[fragment.text] = url;
      }
    }

    return emotesMap;
  }

  private parseBadgeImages(badges: ESChatBadge[]): Record<string, string> {
    const badgeImages: Record<string, string> = {};

    for (const badge of badges) {
      const badgeId = this.getBadgeId(badge.set_id, badge.id);
      if (!badgeId) continue;

      const badgeUrl = `https://static-cdn.jtvnw.net/badges/v1/${badgeId}/2`;
      badgeImages[badge.set_id] = badgeUrl;
    }

    return badgeImages;
  }

  private getBadgeId(badgeName: string, badgeVersion: string): string | null {
    if (badgeName === 'sub-gifter') {
      return kSubGifterBadgeMapping[badgeVersion] || kSubGifterBadgeMapping['1'];
    }

    if (badgeName === 'bits') {
      return kBitsBadgeMapping[badgeVersion] || kBitsBadgeMapping['1'];
    }

    return kTwitchBadgeMapping[badgeName] ?? null;
  }

  private setActive(active: boolean): void {
    if (this.active !== active) {
      this.active = active;
      this.emit('status', active);
    }
  }
}
