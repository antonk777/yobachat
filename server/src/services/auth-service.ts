import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import chalk from 'chalk';

import type { AdminConfig, AuthenticatedUser, ServerConfig } from '@/types.js';
import type { SharedConfig } from '@shared/shared-types.js';
import { getApiOrigin, isSecureSharedConfig, joinSharedPath } from '@shared/shared-urls.js';

const kTokenExpiration = 365 * 24 * 60 * 60; // 365 days in seconds
const kStateExpiration = 10 * 60 * 1000; // 10 minutes in milliseconds

/** Synthetic admin identity when `sharedConfig.secure === false` (local HTTP only). */
export const kLocalAdminUsername = 'local';

/** Stored next to other server data; used for EventSub `channel.chat.message` (refresh_token rotation). */
const kChatOAuthFilePath = join(process.cwd(), 'storage', 'twitch-chat-oauth.json');

/**
 * Admin login + Twitch chat EventSub. `user:bot` + `user:read:chat` are required for
 * `channel.chat.message` webhook subscriptions (see Twitch docs / forum).
 */
const kTwitchOAuthScopes = 'user:read:email user:read:chat user:bot';

const kRefreshSkewMs = 120_000; // refresh if access token expires within 2 minutes

interface PersistedChatOAuth {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id: string;
}

interface StateInfo {
  state: string;
  expiresAt: number;
}

interface TwitchTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string[];
}

interface TwitchUserResponse {
  id: string;
  login: string;
  display_name: string;
  type: string;
  broadcaster_type: string;
  description: string;
  profile_image_url: string;
  offline_image_url: string;
  view_count: number;
  email?: string;
  created_at: string;
}

/**
 * Service for handling Twitch OAuth authentication
 */
export class AuthService {
  private logPrefix = chalk.cyan('[Auth]');
  private config: AdminConfig;
  private sharedConfig: SharedConfig;
  private stateMap: Map<string, StateInfo> = new Map();
  private readonly jwtSecret: string;

  /** Serialize refresh so parallel callers do not double-POST to Twitch. */
  private chatOAuthRefreshPromise: Promise<void> | null = null;

  constructor(config: ServerConfig) {
    this.config = config.admin;
    this.sharedConfig = config.sharedConfig;
    // Generate a secret from clientSecret for JWT signing
    // In production, you might want a separate secret
    this.jwtSecret = createHash('sha256').update(this.config.twitchOAuth.clientSecret).digest('hex');

    // Clean up expired states every 5 minutes
    setInterval(() => this.cleanupExpiredStates(), 5 * 60 * 1000);
  }

  /** True when shared config opts into insecure local HTTP (`secure: false`). */
  isLocalMode(): boolean {
    return !isSecureSharedConfig(this.sharedConfig);
  }

  /**
   * Issue a JWT for local admin access. Only available when `secure: false`.
   */
  issueLocalAdminToken(): { token: string; username: string } | null {
    if (!this.isLocalMode()) {
      return null;
    }

    const username = kLocalAdminUsername;
    console.log(`${this.logPrefix} Issuing local admin token (secure: false)`);
    return { token: this.generateToken(username), username };
  }

  /**
   * Generate a Twitch OAuth login URL
   */
  getLoginUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.twitchOAuth.clientId,
      redirect_uri: this.getCallbackUrl(),
      response_type: 'code',
      scope: kTwitchOAuthScopes,
      state: state
    });

    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Get the OAuth callback URL
   */
  private getCallbackUrl(): string {
    return `${getApiOrigin(this.sharedConfig)}${joinSharedPath(this.sharedConfig, 'auth/twitch/callback')}`;
  }

  /**
   * Generate and store a state parameter for CSRF protection
   */
  generateState(): string {
    const state = randomBytes(32).toString('hex');
    this.stateMap.set(state, {
      state,
      expiresAt: Date.now() + kStateExpiration
    });
    return state;
  }

  /**
   * Verify and consume a state parameter
   */
  verifyState(state: string): boolean {
    const stateInfo = this.stateMap.get(state);
    if (!stateInfo) {
      return false;
    }

    if (Date.now() > stateInfo.expiresAt) {
      this.stateMap.delete(state);
      return false;
    }

    // Consume the state (delete it)
    this.stateMap.delete(state);
    return true;
  }

  /**
   * Handle OAuth callback - exchange code for token and verify user
   */
  async handleCallback(code: string, state: string): Promise<{ token: string; username: string } | null> {
    // Verify state
    if (!this.verifyState(state)) {
      console.warn(`${this.logPrefix} Invalid or expired state parameter`);
      return null;
    }

    try {
      // Exchange code for access token
      const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: this.config.twitchOAuth.clientId,
          client_secret: this.config.twitchOAuth.clientSecret,
          code: code,
          grant_type: 'authorization_code',
          redirect_uri: this.getCallbackUrl()
        })
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error(`${this.logPrefix} Failed to exchange code for token: ${errorText}`);
        return null;
      }

      const tokenData = await tokenResponse.json() as TwitchTokenResponse;

      // Get user info from Twitch API
      const userResponse = await fetch('https://api.twitch.tv/helix/users', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Client-Id': this.config.twitchOAuth.clientId
        }
      });

      if (!userResponse.ok) {
        const errorText = await userResponse.text();
        console.error(`${this.logPrefix} Failed to get user info: ${errorText}`);
        return null;
      }

      const userData = await userResponse.json() as { data: TwitchUserResponse[] };
      const user = userData.data[0];

      if (!user) {
        console.error(`${this.logPrefix} No user data returned from Twitch`);
        return null;
      }

      const username = user.login.toLowerCase();

      // Check if username is allowed
      if (!this.isUsernameAllowed(username)) {
        console.warn(`${this.logPrefix} Username ${username} is not in allowlist`);
        return null;
      }

      // Generate JWT token
      const token = this.generateToken(username);

      // Persist Twitch user tokens for EventSub (Helix) — same OAuth code, includes user:read:chat
      try {
        await this.persistChatOAuthTokens(tokenData, user.id);
      } catch (persistErr) {
        console.error(`${this.logPrefix} Failed to persist Twitch chat OAuth file:`, persistErr);
      }

      return { token, username };
    } catch (error) {
      console.error(`${this.logPrefix} Error in OAuth callback:`, error);
      return null;
    }
  }

  /**
   * Generate a JWT token for a username
   */
  private generateToken(username: string): string {
    const payload = {
      username: username.toLowerCase(),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + kTokenExpiration
    };

    return jwt.sign(payload, this.jwtSecret, { algorithm: 'HS256' });
  }

  /**
   * Verify a JWT token and return the username
   */
  verifyToken(token: string): { username: string } | null {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, { algorithms: ['HS256'] }) as AuthenticatedUser;
      return { username: decoded.username.toLowerCase() };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
        return null;
      }
      console.error(`${this.logPrefix} Error verifying token:`, error);
      return null;
    }
  }

  /**
   * True if `storage/twitch-chat-oauth.json` exists and has access + refresh + user id (sync read).
   */
  hasPersistedChatOAuthTokens(): boolean {
    try {
      const raw = readFileSync(kChatOAuthFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedChatOAuth;
      return (
        typeof parsed.access_token === 'string' &&
        parsed.access_token.length > 0 &&
        typeof parsed.refresh_token === 'string' &&
        typeof parsed.user_id === 'string'
      );
    } catch {
      return false;
    }
  }

  /**
   * Valid access token for Helix / EventSub, refreshing with refresh_token when near expiry.
   * Populated when an allowlisted admin completes `/auth/twitch/login` (see `storage/twitch-chat-oauth.json`).
   */
  async getChatOAuthAccessToken(): Promise<string | null> {
    const state = await this.getChatOAuthState();
    return state?.access_token ?? null;
  }

  /**
   * Numeric Twitch user id for the persisted OAuth session (EventSub `user_id` condition).
   */
  async getChatOAuthUserId(): Promise<string | null> {
    const state = await this.getChatOAuthState();
    return state?.user_id ?? null;
  }

  /**
   * Live token metadata from Twitch `GET /oauth2/validate` (scopes, login). Used for EventSub diagnostics.
   */
  async getChatOAuthTokenInfo(): Promise<{
    login: string;
    user_id: string;
    scopes: string[];
  } | null> {
    const token = await this.getChatOAuthAccessToken();
    if (!token) {
      return null;
    }
    try {
      const res = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as {
        login?: string;
        user_id?: string;
        scopes?: string[];
      };
      const user_id = typeof data.user_id === 'string' ? data.user_id : '';
      if (!user_id) {
        return null;
      }
      return {
        login: typeof data.login === 'string' ? data.login : '',
        user_id,
        scopes: Array.isArray(data.scopes) ? data.scopes : [],
      };
    } catch {
      return null;
    }
  }

  private async getChatOAuthState(): Promise<PersistedChatOAuth | null> {
    let state = await this.loadChatOAuth();
    if (!state) {
      return null;
    }
    if (state.expires_at - Date.now() >= kRefreshSkewMs) {
      return state;
    }
    if (!this.chatOAuthRefreshPromise) {
      this.chatOAuthRefreshPromise = (async () => {
        await this.refreshChatOAuth(state!);
      })().finally(() => {
        this.chatOAuthRefreshPromise = null;
      });
    }
    await this.chatOAuthRefreshPromise;
    return this.loadChatOAuth();
  }

  private async loadChatOAuth(): Promise<PersistedChatOAuth | null> {
    try {
      const raw = await readFile(kChatOAuthFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedChatOAuth;
      if (
        typeof parsed.access_token !== 'string' ||
        typeof parsed.refresh_token !== 'string' ||
        typeof parsed.user_id !== 'string'
      ) {
        return null;
      }
      // `expires_at` may be null in JSON if an older bug wrote NaN, or manual edit — treat as expired.
      let expires_at = parsed.expires_at;
      if (typeof expires_at !== 'number' || !Number.isFinite(expires_at)) {
        expires_at = 0;
      }
      return { ...parsed, expires_at };
    } catch {
      return null;
    }
  }

  private async persistChatOAuthTokens(tokenData: TwitchTokenResponse, userId: string): Promise<void> {
    const existing = await this.loadChatOAuth();
    const refresh =
      tokenData.refresh_token ?? existing?.refresh_token ?? '';

    if (!refresh) {
      console.warn(
        `${this.logPrefix} Twitch token response had no refresh_token; EventSub may stop working when access token expires. Re-authorize the app.`,
      );
    }

    const expiresInSec =
      typeof tokenData.expires_in === 'number' && Number.isFinite(tokenData.expires_in)
        ? tokenData.expires_in
        : 14_400; // Twitch often uses ~4h if field missing
    const expires_at = Date.now() + expiresInSec * 1000;
    const toSave: PersistedChatOAuth = {
      access_token: tokenData.access_token,
      refresh_token: refresh,
      expires_at,
      user_id: userId,
    };

    await mkdir(dirname(kChatOAuthFilePath), { recursive: true });
    await writeFile(kChatOAuthFilePath, JSON.stringify(toSave, null, 2), 'utf-8');
    console.log(`${this.logPrefix} Saved Twitch chat OAuth tokens for user_id ${userId}`);
  }

  private async refreshChatOAuth(state: PersistedChatOAuth): Promise<void> {
    if (!state.refresh_token) {
      console.error(`${this.logPrefix} Cannot refresh Twitch chat token: missing refresh_token. Log in again via /auth/twitch/login`);
      return;
    }

    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.config.twitchOAuth.clientId,
        client_secret: this.config.twitchOAuth.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: state.refresh_token,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(`${this.logPrefix} Twitch token refresh failed: ${errorText}`);
      return;
    }

    const tokenData = await tokenResponse.json() as TwitchTokenResponse;
    await this.persistChatOAuthTokens(tokenData, state.user_id);
  }

  /**
   * Check if a username is in the allowlist
   */
  isUsernameAllowed(username: string): boolean {
    const normalizedUsername = username.toLowerCase();

    if (this.isLocalMode() && normalizedUsername === kLocalAdminUsername) {
      return true;
    }

    return this.config.allowedTwitchUsernames.some(
      allowed => allowed.toLowerCase() === normalizedUsername
    );
  }

  /**
   * Clean up expired state entries
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, info] of this.stateMap.entries()) {
      if (now > info.expiresAt) {
        this.stateMap.delete(state);
      }
    }
  }
}

