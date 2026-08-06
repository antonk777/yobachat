import jwt from 'jsonwebtoken';
import { createHash, timingSafeEqual } from 'node:crypto';
import chalk from 'chalk';

import type { AuthenticatedUser, ServerConfig } from '@/types.js';

const kTokenExpiration = 365 * 24 * 60 * 60; // 365 days in seconds

/** Synthetic admin identity for local mode. */
export const kLocalAdminUsername = 'local';

const kLocalJwtSeed = 'yobachat-local-admin';

/**
 * Password-based local admin authentication.
 */
export class AuthService {
  private logPrefix = chalk.cyan('[Auth]');
  private readonly adminPassword: string;
  private readonly jwtSecret: string;

  constructor(config: ServerConfig) {
    this.adminPassword = config.adminPassword;
    // Changing the password invalidates previously issued JWTs
    this.jwtSecret = createHash('sha256')
      .update(`${kLocalJwtSeed}:${this.adminPassword}`)
      .digest('hex');
  }

  /**
   * Verify password and issue a JWT. Returns null on wrong password.
   */
  loginWithPassword(password: string): { token: string; username: string } | null {
    if (!this.isPasswordValid(password)) {
      console.warn(`${this.logPrefix} Admin login failed: invalid password`);
      return null;
    }

    const username = kLocalAdminUsername;
    console.log(`${this.logPrefix} Admin login ok`);
    return { token: this.generateToken(username), username };
  }

  private isPasswordValid(password: string): boolean {
    const expected = Buffer.from(this.adminPassword, 'utf8');
    const provided = Buffer.from(password, 'utf8');

    if (expected.length !== provided.length) {
      return false;
    }

    return timingSafeEqual(expected, provided);
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
    return username.toLowerCase() === kLocalAdminUsername;
  }
}
