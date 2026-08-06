import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import chalk from 'chalk';

import type { AuthenticatedUser, ServerConfig } from '@/types.js';
import type { SharedConfig } from '@shared/shared-types.js';
import { isSecureSharedConfig } from '@shared/shared-urls.js';

const kTokenExpiration = 365 * 24 * 60 * 60; // 365 days in seconds

/** Synthetic admin identity for local HTTP mode. */
export const kLocalAdminUsername = 'local';

const kLocalJwtSeed = 'yobachat-local-admin';

/**
 * Local-only admin authentication (no Twitch OAuth).
 */
export class AuthService {
  private logPrefix = chalk.cyan('[Auth]');
  private sharedConfig: SharedConfig;
  private readonly jwtSecret: string;

  constructor(config: ServerConfig) {
    this.sharedConfig = config.sharedConfig;
    this.jwtSecret = createHash('sha256').update(kLocalJwtSeed).digest('hex');
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
      console.warn(`${this.logPrefix} Refusing local admin token — set secure: false`);
      return null;
    }

    const username = kLocalAdminUsername;
    console.log(`${this.logPrefix} Issuing local admin token`);
    return { token: this.generateToken(username), username };
  }

  private generateToken(username: string): string {
    const payload = {
      username: username.toLowerCase(),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + kTokenExpiration
    };

    return jwt.sign(payload, this.jwtSecret, { algorithm: 'HS256' });
  }

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

  isUsernameAllowed(username: string): boolean {
    return this.isLocalMode() && username.toLowerCase() === kLocalAdminUsername;
  }
}
