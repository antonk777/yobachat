import { EventEmitter } from 'node:events';
import chalk from 'chalk';
import uWS from 'uWebSockets.js';

import type { ServerConfig } from '@/types.js';
import type { WSMessage, WSMessageTypeMap } from '@shared/shared-types.js';
import { decodeWSMessage, encodeWSMessage } from '@shared/shared-messenger.js';
import { validateWSMessage } from '@/validation.js';

export interface WebSocketEvents {
  'connection': [clientId: string];
  'disconnection': [clientId: string, code: number];
  'message': [clientId: string, message: WSMessage];
  'error': [clientId: string, error: string];
}

/**
 * WebSocket service for managing WebSocket connections and message passing
 * Emits events for connections, disconnections, and raw messages
 */
export class WebSocketService extends EventEmitter<WebSocketEvents> {
  public logPrefix = chalk.blue('[WebSocket]');

  private app: uWS.TemplatedApp | null = null;
  private clients: Map<string, uWS.WebSocket<any>> = new Map();
  private config: ServerConfig;
  private clientIdCounter = 0;

  constructor(config: ServerConfig) {
    super();
    this.config = config;
  }

  /**
   * Generate a unique client ID
   */
  private generateClientId(): string {
    return `client_${++this.clientIdCounter}`;
  }

  /**
   * Start the WebSocket server
   */
  async start(): Promise<void> {
    if (this.config.consoleMode) {
      console.log(`${this.logPrefix} Skipping WebSocket server in console-only mode`);
      return;
    }

    this.app = uWS.App();
    this.setupWsConnectionHandlers();

    return new Promise((resolve, reject) => {
      this.app!.listen(this.config.wsPort, (listenSocket) => {
        if (listenSocket) {
          console.log(`${this.logPrefix} WebSocket server listening on port ${this.config.wsPort}`);
          resolve();
        } else {
          console.error(`${this.logPrefix} Failed to bind to port ${this.config.wsPort}`);
          reject(new Error(`Failed to bind WebSocket server to port ${this.config.wsPort}`));
        }
      });
    });
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    if (!this.app) {
      return;
    }

    this.clients.forEach((ws) => {
      try {
        ws.close();
      } catch (error) {
        // Ignore errors during shutdown
      }
    });

    this.clients.clear();
    this.app = null;
  }

  /**
   * Get the number of connected clients
   */
  getConnectionCount(): number {
    return this.clients.size;
  }

  /**
   * Send a message to a specific client by ID
   */
  send<T extends keyof WSMessageTypeMap>(clientId: string, type: T, data: WSMessageTypeMap[T]['data']): void {
    const ws = this.clients.get(clientId);

    if (!ws) {
      console.warn(`${this.logPrefix} Client ${clientId} not found`);
      return;
    }

    try {
      const message = { type, data } as WSMessageTypeMap[T];
      const encoded = encodeWSMessage(message);
      ws.send(encoded, false);
    } catch (error) {
      console.error(`${this.logPrefix} Failed to send message to ${clientId}:`, error);
      this.clients.delete(clientId);
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast<T extends keyof WSMessageTypeMap>(type: T, data: WSMessageTypeMap[T]['data']): void {
    if (this.config.consoleMode || !this.app) {
      return;
    }

    try {
      const message = { type, data } as WSMessageTypeMap[T];
      const encoded = encodeWSMessage(message);
      this.clients.forEach((ws, clientId) => {
        try {
          ws.send(encoded, false);
        } catch (error) {
          console.error(`${this.logPrefix} Failed to broadcast message to ${clientId}:`, error);
          this.clients.delete(clientId);
        }
      });
    } catch (error) {
      console.error(`${this.logPrefix} Failed to encode broadcast message:`, error);
    }
  }

  /**
   * Handle incoming message from a WebSocket client
   */
  private handleIncomingMessage(ws: uWS.WebSocket<any>, message: ArrayBuffer): void {
    // Find client ID by WebSocket instance
    let clientId: string | undefined;
    for (const [id, clientWs] of this.clients.entries()) {
      if (clientWs === ws) {
        clientId = id;
        break;
      }
    }

    if (!clientId) {
      console.warn(`${this.logPrefix} Received message from unknown client`);
      return;
    }

    try {
      // Convert ArrayBuffer to string
      const messageStr = new TextDecoder().decode(message);

      // decodeWSMessage includes validation - returns null if invalid
      const parsedMessage = decodeWSMessage(messageStr);

      if (!parsedMessage) {
        this.emit('error', clientId, 'Invalid message format or structure');
        return;
      }

      // Additional deep validation with Zod for extra security
      const validatedMessage = validateWSMessage(parsedMessage);

      if (!validatedMessage) {
        console.warn(`${this.logPrefix} Message from ${clientId} passed basic validation but failed deep validation`);
        this.emit('error', clientId, 'Invalid message structure');
        return;
      }

      // Emit validated message with client ID
      this.emit('message', clientId, validatedMessage);
    } catch (error) {
      console.error(`${this.logPrefix} Error processing message from ${clientId}:`, error);
      this.emit('error', clientId, 'Error processing message');
    }
  }

  /**
   * Set up WebSocket connection handlers
   */
  private setupWsConnectionHandlers(): void {
    if (!this.app) {
      return;
    }

    this.app.ws(this.config.sharedConfig.wsPath, {
      compression: uWS.DISABLED,
      maxPayloadLength: 4 * 1024 * 1024,
      idleTimeout: 32,
      maxBackpressure: 1024,

      open: (ws: uWS.WebSocket<any>) => {
        const clientId = this.generateClientId();
        this.clients.set(clientId, ws);
        console.log(`${this.logPrefix} WS Client connected: ${clientId}`);
        this.emit('connection', clientId);
      },

      close: (ws: uWS.WebSocket<any>, code: number, message: ArrayBuffer) => {
        // Find client ID by WebSocket instance
        let clientId: string | undefined;
        for (const [id, clientWs] of this.clients.entries()) {
          if (clientWs === ws) {
            clientId = id;
            break;
          }
        }

        if (clientId) {
          console.log(`${this.logPrefix} WS Client disconnected: ${clientId} (code: ${code})`);
          this.clients.delete(clientId);
          this.emit('disconnection', clientId, code);
        }
      },

      message: (ws: uWS.WebSocket<any>, message: ArrayBuffer, isBinary: boolean) => {
        this.handleIncomingMessage(ws, message);
      },

      drain: (ws: uWS.WebSocket<any>) => {
        // Handle backpressure relief
      },

      ping: (ws: uWS.WebSocket<any>, message: ArrayBuffer) => {
        // Handle ping
      },

      pong: (ws: uWS.WebSocket<any>, message: ArrayBuffer) => {
        // Handle pong
      }
    });
  }

}