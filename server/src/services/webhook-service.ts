import express, { Express } from 'express';
import { createServer, Server as HttpServer } from 'http';
import chalk from 'chalk';

import type { WebhookHandler } from '../types.js';

const kMaxRequestSize = '1mb';

/**
 * Service for handling webhook requests (HTTP server behind nginx SSL termination)
 */
export class WebhookService {
  private logPrefix = chalk.cyan('[WebhookService]');
  private app: Express;
  private server: HttpServer | null = null;
  private webhookHandlers: Map<string, WebhookHandler> = new Map();
  private port: number;

  constructor(port: number) {
    this.port = port;
    this.app = express();

    // Parse JSON bodies
    this.app.use(express.json({ limit: kMaxRequestSize }));

    // Handle all POST requests - route to registered handlers
    this.app.post('*', (req, res) => {
      const path = req.path;

      // Find matching webhook handler
      for (const [handlerPath, handler] of this.webhookHandlers.entries()) {
        if (path.startsWith(handlerPath)) {
          handler(req, res);
          return;
        }
      }

      res.status(404).json({ error: 'Not found' });
    });

    // Handle non-POST requests
    this.app.use((_, res) => {
      res.status(404).json({ error: 'Not found' });
    });
  }

  /**
   * Start the webhook server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = createServer(this.app);

        this.server.listen(this.port, () => {
          console.log(`${this.logPrefix} HTTP webhook server listening on port ${this.port} (nginx handles SSL)`);
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
   * Register a webhook handler
   */
  registerHandler(path: string, handler: WebhookHandler): void {
    this.webhookHandlers.set(path, handler);
  }

  /**
   * Unregister a webhook handler
   */
  unregisterHandler(path: string): void {
    this.webhookHandlers.delete(path);
  }

  /**
   * Stop the webhook server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          console.log(`${this.logPrefix} Webhook server stopped`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

