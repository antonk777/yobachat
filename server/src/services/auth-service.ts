import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import chalk from 'chalk';

import type { AdminConfig, ServerConfig } from '@/types.js';
import type { SharedConfig } from '@shared/shared-types.js';

const kTokenExpiration = 365 * 24 * 60 * 60; // 365 days in seconds
const kStateExpiration = 10 * 60 * 1000; // 10 minutes in milliseconds

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

  constructor(config: ServerConfig) {
    this.config = config.admin;
    this.sharedConfig = config.sharedConfig;
    // Generate a secret from clientSecret for JWT signing
    // In production, you might want a separate secret
    this.jwtSecret = createHash('sha256').update(this.config.twitchOAuth.clientSecret).digest('hex');

    // Clean up expired states every 5 minutes
    setInterval(() => this.cleanupExpiredStates(), 5 * 60 * 1000);
  }

  /**
   * Generate a Twitch OAuth login URL
   */
  getLoginUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.twitchOAuth.clientId,
      redirect_uri: this.getCallbackUrl(),
      response_type: 'code',
      scope: 'user:read:email',
      state: state
    });

    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Get the OAuth callback URL
   */
  private getCallbackUrl(): string {
    return `https://${this.sharedConfig.apiHost}${this.sharedConfig.basePath}auth/twitch/callback`;
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
      const decoded = jwt.verify(token, this.jwtSecret, { algorithms: ['HS256'] }) as { username: string };
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
   * Check if a username is in the allowlist
   */
  isUsernameAllowed(username: string): boolean {
    const normalizedUsername = username.toLowerCase();
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

