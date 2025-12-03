/**
 * Health check thresholds and constants
 */

/**
 * Memory usage percentage threshold for warning status
 * When memory usage exceeds this, health status becomes 'degraded'
 */
export const kMemoryWarningThreshold = 80; // 80% usage is warning

/**
 * Memory usage percentage threshold for critical/overloaded status
 * When memory usage exceeds this, health status becomes 'overloaded'
 */
export const kMemoryCriticalThreshold = 95; // 95% usage is critical

/**
 * Server startup time in seconds
 * During this period, health status will be 'starting'
 */
export const kServerStartupTimeSeconds = 30; // First 30 seconds are considered startup

