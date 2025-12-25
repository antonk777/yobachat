import { EventEmitter } from 'node:events';
import chalk from 'chalk';
import uWS from 'uWebSockets.js';

import type { ServerConfig, AuthenticatedUser } from '@/types.js';
import type { WSMessage, WSMessageTypeMap } from '@shared/shared-types.js';
import { decodeWSMessage, encodeWSMessage } from '@shared/shared-messenger.js';
import { validateWSMessage } from '@/validation.js';
import type { AuthService } from './auth-service.js';


export interface WebSocketEvents {
  'connection': [clientId: string];
  'disconnection': [clientId: string, code: number];
  'message': [clientId: string, message: WSMessage];
  'error': [clientId: string, error: string];
}

interface WebSocketUserData {
  wsKey?: string;
  authInfo: AuthenticatedUser | null;
}

/**
 * WebSocket service for managing WebSocket connections and message passing
 * Emits events for connections, disconnections, and raw messages
 */
export class WebSocketService extends EventEmitter<WebSocketEvents> {
  public logPrefix = chalk.blue('[WebSocket]');

  private app: uWS.TemplatedApp | null = null;
  private clients: Map<string, uWS.WebSocket<WebSocketUserData>> = new Map();
  private authenticatedUsers: Map<string, AuthenticatedUser> = new Map();
  private config: ServerConfig;
  private authService: AuthService;
  private clientIdCounter = 0;

  constructor(config: ServerConfig, authService: AuthService) {
    super();
    this.config = config;
    this.authService = authService;
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
   * Get authenticated user for a client ID
   */
  getAuthenticatedUser(clientId: string): AuthenticatedUser | null {
    return this.authenticatedUsers.get(clientId) || null;
  }

  /**
   * Send a message to a specific client by ID
   */
  send<T extends keyof WSMessageTypeMap>(
    clientId: string,
    type: T,
    data: WSMessageTypeMap[T]['data']
  ): void {
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
  broadcast<T extends keyof WSMessageTypeMap>(
    type: T,
    data: WSMessageTypeMap[T]['data'],
    clientGuard?: (clientId: string) => boolean
  ): void {
    if (this.config.consoleMode || !this.app) {
      return;
    }

    try {
      const message = { type, data } as WSMessageTypeMap[T];

      const encoded = encodeWSMessage(message);

      this.clients.forEach((ws, clientId) => {
        if (clientGuard && !clientGuard(clientId)) {
          return;
        }

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
  private handleIncomingMessage(ws: uWS.WebSocket<WebSocketUserData>, message: ArrayBuffer): void {
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

    // Normalize wsPath to always start with /
    const wsPath = this.config.sharedConfig.wsPath.startsWith('/')
      ? this.config.sharedConfig.wsPath
      : `/${this.config.sharedConfig.wsPath}`;

    this.app.ws(wsPath, {
      compression: uWS.DISABLED,
      maxPayloadLength: 4 * 1024 * 1024,
      idleTimeout: 32,
      maxBackpressure: 1024,

        upgrade: (res, req, context) => {
        // Extract token from query string and verify if present
        const token = req.getQuery('token') || '';
        const wsKey = req.getHeader('sec-websocket-key');

        console.log(`${this.logPrefix} WebSocket upgrade request. Token present: ${!!token}, Token length: ${token.length}`);

        let authInfo: AuthenticatedUser | null = null;

        // If token provided and auth service available, verify it
        if (token && wsKey) {
          const user = this.authService.verifyToken(token);
          console.log(`${this.logPrefix} Token verification result:`, user ? `User: ${user.username}` : 'Invalid token');

          if (user && this.authService.isUsernameAllowed(user.username)) {
            authInfo = { username: user.username };
            console.log(`${this.logPrefix} User ${user.username} is allowed, setting authInfo`);
          } else if (user) {
            console.log(`${this.logPrefix} User ${user.username} is NOT allowed`);
          }
        } else {
          console.log(`${this.logPrefix} No token provided in WebSocket upgrade`);
        }

        const userData: WebSocketUserData = { wsKey, authInfo };
        res.upgrade(
          userData,
          wsKey,
          req.getHeader('sec-websocket-protocol'),
          req.getHeader('sec-websocket-extensions'),
          context
        );
      },

      open: (ws: uWS.WebSocket<WebSocketUserData>) => {
        const clientId = this.generateClientId();
        this.clients.set(clientId, ws);

        // Try to get authenticated user info from userData
        try {
          const userData = ws.getUserData();
          console.log(`${this.logPrefix} WS Client ${clientId} connected. authInfo:`, userData.authInfo);
          if (userData.authInfo != null) {
            this.authenticatedUsers.set(clientId, userData.authInfo);
            console.log(`${this.logPrefix} WS Client connected (authenticated): ${clientId} (${userData.authInfo.username})`);
            this.emit('connection', clientId);
            return;
          }
        } catch (error) {
          console.warn(`${this.logPrefix} Failed to access userData in open handler:`, error);
        }

        console.log(`${this.logPrefix} WS Client connected (unauthenticated): ${clientId}`);
        this.emit('connection', clientId);
      },

      close: (ws: uWS.WebSocket<WebSocketUserData>, code: number, message: ArrayBuffer) => {
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
          this.authenticatedUsers.delete(clientId);
          this.emit('disconnection', clientId, code);
        }
      },

      message: (ws: uWS.WebSocket<WebSocketUserData>, message: ArrayBuffer, isBinary: boolean) => {
        this.handleIncomingMessage(ws, message);
      },

      drain: (ws: uWS.WebSocket<WebSocketUserData>) => {
        // Handle backpressure relief
      },

      ping: (ws: uWS.WebSocket<WebSocketUserData>, message: ArrayBuffer) => {
        // Handle ping
      },

      pong: (ws: uWS.WebSocket<WebSocketUserData>, message: ArrayBuffer) => {
        // Handle pong
      }
    });
  }

}