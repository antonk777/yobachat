import { createServer, IncomingMessage, ServerResponse } from 'http';
import chalk from 'chalk';

import type {
  PlatformWithService,
  HealthStatus,
  HealthStatusType,
  HealthCheckConfig,
  HealthStatusProvider
} from '@/types.js';
import {
  kMemoryWarningThreshold,
  kMemoryCriticalThreshold,
  kServerStartupTimeSeconds
} from '@/constants/health.js';

/**
 * Service for managing the health check HTTP endpoint
 */
export class HealthCheckService {
  private healthServer: ReturnType<typeof createServer> | null = null;
  private readonly config: HealthCheckConfig;
  private readonly getHealthStatus: HealthStatusProvider;
  private readonly logPrefix: string;

  constructor(config: HealthCheckConfig, getHealthStatus: HealthStatusProvider) {
    this.config = config;
    this.getHealthStatus = getHealthStatus;
    this.logPrefix = chalk.cyan('[HealthCheck]');
  }

  /**
   * Start the health check HTTP server
   */
  start(): void {
    if (!this.config.port) {
      return;
    }

    const { port, authToken } = this.config;

    this.healthServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      this.handleRequest(req, res, authToken);
    });

    this.healthServer.listen(port, () => {
      const authInfo = authToken ? ' (with authentication)' : ' (no authentication)';
      console.log(`${this.logPrefix} Health check server listening on port ${port}${authInfo}`);
    });

    this.healthServer.on('error', (error: Error) => {
      console.error(`${this.logPrefix} Health check server error:`, error);
    });
  }

  /**
   * Handle incoming HTTP requests
   */
  private handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    authToken?: string
  ): void {
    // Only handle GET requests to /health
    if (req.url === '/health' && req.method === 'GET') {
      // Check authentication if token is configured
      if (authToken) {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          res.writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer'
          });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        if (token !== authToken) {
          res.writeHead(403, {
            'Content-Type': 'application/json'
          });
          res.end(JSON.stringify({ error: 'Forbidden' }));
          return;
        }
      }

      // Get health status
      const healthStatus = this.getHealthStatus();

      // Return 200 for operational/starting, 503 for degraded/critical/overloaded
      const statusCode = (healthStatus.status === 'operational' || healthStatus.status === 'starting')
        ? 200
        : 503;

      res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      });
      res.end(JSON.stringify(healthStatus, null, 2));
    } else {
      // 404 for all other routes
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    }
  }

  /**
   * Stop the health check server
   */
  stop(): void {
    if (this.healthServer) {
      this.healthServer.close(() => {
        console.log(`${this.logPrefix} Health check server stopped`);
      });
      this.healthServer = null;
    }
  }

  /**
   * Generate health status from platform and WebSocket data
   * Uses comprehensive checks to determine accurate health status
   */
  static generateHealthStatus(
    platforms: Map<string, PlatformWithService>,
    wss: { clients: { size: number } } | null
  ): HealthStatus {
    const uptime = Math.round(process.uptime());
    const platformsStatus = Array.from(platforms.values()).map(platform => ({
      name: platform.name,
      id: platform.id,
      active: platform.service?.isActive() ?? false,
    }));

    const activePlatforms = platformsStatus.filter(p => p.active).length;
    const totalPlatforms = platformsStatus.length;
    const inactivePlatforms = totalPlatforms - activePlatforms;

    // Memory analysis
    const memoryUsage = process.memoryUsage();
    const memoryUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const memoryTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
    const memoryUsagePercent = memoryTotalMB > 0
      ? Math.round((memoryUsedMB / memoryTotalMB) * 100)
      : 0;

    // Memory health thresholds
    const memoryHealthy = memoryUsagePercent < kMemoryWarningThreshold;

    // WebSocket health
    const websocketEnabled = wss !== null;
    const websocketConnections = wss?.clients.size ?? 0;
    // WebSocket is healthy if enabled and available, or if not required (console mode)
    const websocketHealthy = !websocketEnabled || wss !== null;

    // Collect issues
    const issues: string[] = [];

    // Check if server is starting
    const isStarting = uptime < kServerStartupTimeSeconds;

    // Platform connectivity issues
    if (totalPlatforms > 0) {
      if (activePlatforms === 0) {
        issues.push('All chat platforms are disconnected');
      } else if (inactivePlatforms > 0) {
        const inactiveNames = platformsStatus
          .filter(p => !p.active)
          .map(p => p.name)
          .join(', ');
        issues.push(`${inactivePlatforms} platform(s) disconnected: ${inactiveNames}`);
      }
    }

    // WebSocket issues
    if (websocketEnabled && !websocketHealthy) {
      issues.push('WebSocket server is not available');
    }

    // Memory issues
    if (memoryUsagePercent >= kMemoryCriticalThreshold) {
      issues.push(`Critical memory usage: ${memoryUsagePercent}%`);
    } else if (memoryUsagePercent >= kMemoryWarningThreshold) {
      issues.push(`High memory usage: ${memoryUsagePercent}%`);
    }

    // Determine overall health status
    let status: HealthStatusType;

    if (isStarting) {
      status = 'starting';
    } else if (memoryUsagePercent >= kMemoryCriticalThreshold) {
      status = 'overloaded';
    } else if (totalPlatforms > 0 && activePlatforms === 0) {
      // All platforms down - critical
      status = 'critical';
    } else if (
      inactivePlatforms > 0 ||
      !memoryHealthy ||
      (websocketEnabled && !websocketHealthy)
    ) {
      // Some issues but still functional
      status = 'degraded';
    } else {
      // Everything operational
      status = 'operational';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime,
      platforms: platformsStatus,
      platformStats: {
        total: totalPlatforms,
        active: activePlatforms,
        inactive: inactivePlatforms
      },
      websocket: {
        enabled: websocketEnabled,
        connections: websocketConnections,
        healthy: websocketHealthy
      },
      memory: {
        used: memoryUsedMB,
        total: memoryTotalMB,
        external: Math.round(memoryUsage.external / 1024 / 1024), // MB
        usagePercent: memoryUsagePercent,
        healthy: memoryHealthy
      },
      node: {
        version: process.version,
        platform: process.platform,
      },
      issues: issues.length > 0 ? issues : []
    };
  }
}

