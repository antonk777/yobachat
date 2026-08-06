import express, { Express } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { createProxyMiddleware } from 'http-proxy-middleware';

import type { FontFamily, FontStyle, FontWeight } from '@shared/shared-types.js';
import type { AuthService } from './auth-service.js';
import { kServerConfig } from '@/config.js';


function resolveClientDist(): string | null {
  const fromEnv = process.env.CLIENT_DIST_PATH;
  if (fromEnv) {
    const resolved = resolve(fromEnv);
    if (existsSync(resolved)) {
      return resolved;
    }
  }

  const candidates = [
    join(process.cwd(), 'client', 'dist'),
    join(process.cwd(), '..', 'client', 'dist'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function withLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * HTTP API + optional static client + proxies for WS/webhook (replaces nginx).
 */
export class WebAPIService {
  private logPrefix = chalk.magenta('[WebAPI]');
  private app: Express;
  private server: HttpServer | null = null;
  private readonly authService: AuthService;
  private wsUpgradeHandler: ((req: any, socket: any, head: any) => void) | null = null;

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

    const wsPath = withLeadingSlash(kServerConfig.sharedConfig.wsPath);
    const webhookPath = withLeadingSlash(kServerConfig.webhookPath);

    const wsProxy = createProxyMiddleware({
      target: `http://127.0.0.1:${kServerConfig.wsPort}`,
      changeOrigin: true,
      ws: true,
      pathFilter: (pathname) => pathname === wsPath || pathname.startsWith(wsPath.endsWith('/') ? wsPath : `${wsPath}/`),
    });

    const webhookProxy = createProxyMiddleware({
      target: `http://127.0.0.1:${kServerConfig.webhookPort}`,
      changeOrigin: true,
      pathFilter: (pathname) => pathname === webhookPath || pathname.startsWith(webhookPath.endsWith('/') ? webhookPath : `${webhookPath}/`),
    });

    // Proxies first so webhook bodies are not consumed by express.json
    this.app.use(wsProxy);
    this.app.use(webhookProxy);
    this.wsUpgradeHandler = (wsProxy as { upgrade?: (req: any, socket: any, head: any) => void }).upgrade ?? null;

    this.app.use(express.json());

    this.app.get('/fonts', async (_req, res) => {
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

    this.app.post('/auth/login', (req, res) => {
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const result = this.authService.loginWithPassword(password);

      if (!result) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }

      res.json({ token: result.token, username: result.username });
    });

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

    const clientDist = resolveClientDist();

    if (clientDist) {
      console.log(`${this.logPrefix} Serving static client from ${clientDist}`);
      this.app.use(express.static(clientDist));
    } else {
      console.log(`${this.logPrefix} No client dist found — API-only mode`);
    }

    this.app.use((_req, res) => {
      if (clientDist) {
        res.status(404).send('Not found');
        return;
      }
      res.status(404).json({ error: 'Not found' });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = createServer(this.app);

        if (this.wsUpgradeHandler) {
          this.server.on('upgrade', this.wsUpgradeHandler);
        }

        this.server.listen(kServerConfig.apiPort, () => {
          console.log(`${this.logPrefix} HTTP server listening on port ${kServerConfig.apiPort}`);
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
          console.log(`${this.logPrefix} HTTP server stopped`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
