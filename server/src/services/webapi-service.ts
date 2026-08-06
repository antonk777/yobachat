import express, { Express } from 'express';
import { createServer, Server as HttpServer } from 'http';
import chalk from 'chalk';

import type { FontFamily, FontStyle, FontWeight } from '@shared/shared-types.js';
import { kLocalAdminUsername, type AuthService } from './auth-service.js';
import { getClientOrigin } from '@shared/shared-urls.js';
import { kServerConfig } from '@/config.js';


/**
 * Service for handling web API requests (fonts, etc.)
 */
export type WebAPIServiceOptions = {
  /** After Twitch OAuth succeeds and chat tokens are persisted — e.g. start EventSub. */
  onTwitchOAuthSuccess?: () => void | Promise<void>;
};

export class WebAPIService {
  private logPrefix = chalk.magenta('[WebAPI]');
  private app: Express;
  private server: HttpServer | null = null;
  private readonly authService: AuthService;
  private readonly onTwitchOAuthSuccess?: () => void | Promise<void>;

  /**
   * Convert font style names to FontStyle
   * Handles variants like "regular", "italic", "700", "700italic", etc.
   */
  private styleNameToFontStyle(style: string): FontStyle {
    const normalized = style.toLowerCase();
    const weightMatch = normalized.match(/\d+/);
    const weight = (weightMatch ? parseInt(weightMatch[0], 10) : 400) as FontWeight;

    return {
      weight,
      style: normalized.includes('italic') ? 'italic' : 'normal'
    };
  }

  /**
   * Fetch Google Fonts from the API and transform to our format
   */
  private async fetchGoogleFonts(): Promise<FontFamily[]> {
    try {
      // Use the official Google Fonts metadata endpoint
      const response = await fetch('https://fonts.google.com/metadata/fonts');

      if (!response.ok) {
        throw new Error(`Failed to fetch fonts: ${response.statusText}`);
      }

      const data = await response.json();

      // The metadata endpoint returns fonts in a different format
      // It's an object with a "familyMetadataList" array
      if (!data.familyMetadataList || !Array.isArray(data.familyMetadataList)) {
        throw new Error('Google Fonts metadata endpoint returned unexpected data');
      }

      return data.familyMetadataList.map((font: any): FontFamily => {
        // Deduplicate styles in case the API returns overlapping variants
        const stylesMap = new Map<string, FontStyle>();

        // font.fonts is an object with variant names as keys
        Object.keys(font.fonts || {}).forEach((variant: string) => {
          const parsedStyle = this.styleNameToFontStyle(variant);
          stylesMap.set(`${parsedStyle.weight}-${parsedStyle.style}`, parsedStyle);
        });

        return {
          type: 'google',
          family: font.family,
          styles: Array.from(stylesMap.values()),
          subsets: font.subsets || [],
          googlePopularity: font.popularity
        };
      });
    } catch (error) {
      console.error(`${this.logPrefix} Failed to fetch Google Fonts:`, error);
      throw error;
    }
  }

  constructor(authService: AuthService, options?: WebAPIServiceOptions) {
    this.app = express();
    this.authService = authService;
    this.onTwitchOAuthSuccess = options?.onTwitchOAuthSuccess;

    // Enable CORS for all routes
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      next();
    });

    // Parse JSON bodies for auth endpoints
    this.app.use(express.json());

    // GET /fonts endpoint
    this.app.get('/fonts', async (req, res) => {
      try {
        const fonts = await this.fetchGoogleFonts();
        res.json(fonts);
      } catch (error) {
        console.error(`${this.logPrefix} Error fetching fonts:`, error);
        res.status(500).json({
          error: 'Failed to fetch Google Fonts',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // GET /auth/local - Issue admin JWT without Twitch (only when secure: false)
    this.app.get('/auth/local', (req, res) => {
      const result = this.authService.issueLocalAdminToken();

      if (!result) {
        res.status(403).json({
          error: 'Local admin login is only available when sharedConfig.secure is false',
        });
        return;
      }

      const wantsRedirect = req.query.redirect === '1' || req.query.redirect === 'true';

      if (wantsRedirect) {
        const rootUrl = `${getClientOrigin(kServerConfig.sharedConfig)}${kServerConfig.sharedConfig.basePath}`;
        res.redirect(`${rootUrl}login#token=${encodeURIComponent(result.token)}`);
        return;
      }

      res.json({ token: result.token, username: result.username });
    });

    // GET /auth/twitch/login - Redirect to Twitch OAuth
    this.app.get('/auth/twitch/login', (req, res) => {
      const state = this.authService.generateState();
      const loginUrl = this.authService.getLoginUrl(state);
      res.redirect(loginUrl);
    });

    // GET /auth/twitch/callback - Handle OAuth callback
    this.app.get('/auth/twitch/callback', async (req, res) => {
      const { code, state, error } = req.query;

      if (error) {
        console.error(`${this.logPrefix} OAuth error: ${error}`);
        res.redirect(`/login.html?error=${encodeURIComponent(String(error))}`);
        return;
      }

      if (!code || !state) {
        res.status(400).json({ error: 'Missing code or state parameter' });
        return;
      }

      const result = await this.authService.handleCallback(String(code), String(state));

      const rootUrl = `${getClientOrigin(kServerConfig.sharedConfig)}${kServerConfig.sharedConfig.basePath}`;

      if (!result) {
        res.redirect(`${rootUrl}login?error=${encodeURIComponent('Authentication failed')}`);
        return;
      }

      if (this.authService.hasPersistedChatOAuthTokens()) {
        try {
          await this.onTwitchOAuthSuccess?.();
        } catch (hookErr) {
          console.error(`${this.logPrefix} onTwitchOAuthSuccess hook failed:`, hookErr);
        }
      }

      // Redirect to login page with token in hash (will handle redirect to admin)
      // Assumes reverse proxy routes both API and admin panel
      res.redirect(`${rootUrl}login#token=${encodeURIComponent(result.token)}`);
    });

    // GET /auth/verify - Verify token validity (JWT + Twitch chat OAuth on disk / refresh)
    this.app.get('/auth/verify', async (req, res) => {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized', valid: false });
        return;
      }

      const token = authHeader.substring(7);
      const user = this.authService.verifyToken(token);

      if (!user) {
        res.status(401).json({ error: 'Invalid token', valid: false });
        return;
      }

      // Local-mode admin JWT does not use Twitch chat OAuth (IRC path does not need it).
      if (this.authService.isLocalMode() && user.username === kLocalAdminUsername) {
        res.json({
          valid: true,
          username: user.username,
          twitchChatOAuth: true,
        });
        return;
      }

      const twitchAccess = await this.authService.getChatOAuthAccessToken();

      res.json({
        valid: true,
        username: user.username,
        twitchChatOAuth: twitchAccess != null,
      });
    });

    // Health check endpoint
    // this.app.get('/health', (req, res) => {
    //   res.json({ status: 'ok' });
    // });

    // 404 for all other routes
    this.app.use((_, res) => {
      res.status(404).json({ error: 'Not found' });
    });
  }

  /**
   * Start the web API server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = createServer(this.app);

        this.server.listen(kServerConfig.apiPort, () => {
          console.log(`${this.logPrefix} Web API server listening on port ${kServerConfig.apiPort}`);
          resolve();
        });

        this.server.on('error', (error) => {
          console.error(`${this.logPrefix} HTTP server error:`, error);
          reject(error);
        });
      } catch (error) {
        console.error(`${this.logPrefix} Error setting up HTTP server:`, error);
        reject(error);
      }
    });
  }

  /**
   * Stop the web API server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          console.log(`${this.logPrefix} Web API server stopped`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

