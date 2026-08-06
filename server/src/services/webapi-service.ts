import express, { Express } from 'express';
import { createServer, Server as HttpServer } from 'http';
import chalk from 'chalk';

import type { FontFamily, FontStyle, FontWeight } from '@shared/shared-types.js';
import type { AuthService } from './auth-service.js';
import { kServerConfig } from '@/config.js';


/**
 * Service for handling web API requests (fonts, local admin auth)
 */
export class WebAPIService {
  private logPrefix = chalk.magenta('[WebAPI]');
  private app: Express;
  private server: HttpServer | null = null;
  private readonly authService: AuthService;

  private styleNameToFontStyle(style: string): FontStyle {
    const normalized = style.toLowerCase();
    const weightMatch = normalized.match(/\d+/);
    const weight = (weightMatch ? parseInt(weightMatch[0], 10) : 400) as FontWeight;

    return {
      weight,
      style: normalized.includes('italic') ? 'italic' : 'normal'
    };
  }

  private async fetchGoogleFonts(): Promise<FontFamily[]> {
    try {
      const response = await fetch('https://fonts.google.com/metadata/fonts');

      if (!response.ok) {
        throw new Error(`Failed to fetch fonts: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.familyMetadataList || !Array.isArray(data.familyMetadataList)) {
        throw new Error('Google Fonts metadata endpoint returned unexpected data');
      }

      return data.familyMetadataList.map((font: any): FontFamily => {
        const stylesMap = new Map<string, FontStyle>();

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

  constructor(authService: AuthService) {
    this.app = express();
    this.authService = authService;

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

    this.app.use(express.json());

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

    // GET /auth/local — issue admin JWT (requires secure: false)
    this.app.get('/auth/local', (_req, res) => {
      const result = this.authService.issueLocalAdminToken();

      if (!result) {
        res.status(403).json({
          error: 'Local admin login requires sharedConfig.secure: false',
        });
        return;
      }

      res.json({ token: result.token, username: result.username });
    });

    // GET /auth/verify
    this.app.get('/auth/verify', (req, res) => {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized', valid: false });
        return;
      }

      const token = authHeader.substring(7);
      const user = this.authService.verifyToken(token);

      if (!user || !this.authService.isUsernameAllowed(user.username)) {
        res.status(401).json({ error: 'Invalid token', valid: false });
        return;
      }

      res.json({
        valid: true,
        username: user.username,
      });
    });

    this.app.use((_, res) => {
      res.status(404).json({ error: 'Not found' });
    });
  }

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
