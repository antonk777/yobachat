const path = require("path");

/**
 * @typedef {import('pm2').StartOptions} StartOptions
 * @typedef {{ apps: StartOptions[] }} EcosystemFileConfig
 */

/**
 * Base logger paths relative to repo root
 * @type {string}
 */
const logsDir = path.join(__dirname, "logs");


/**
 * PM2 Ecosystem configuration
 * @type {EcosystemFileConfig}
 */
module.exports = {
  apps: [
    {
      name: "yobachat-prod",
      script: "dist/index.js",
      cwd: "./server",
      exec_mode: "fork",
      merge_logs: true,
      min_uptime: 10000,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      time: true,
      // wait_ready: true,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
        SHARED_CONFIG_PATH: path.resolve(__dirname, "shared", "shared-config.prod.json"),
        SERVER_CONFIG_PATH: path.resolve(__dirname, "server", "server-config.prod.json")
      },
      autorestart: true,
      error: path.join(logsDir, "server-error.log"),
      output: path.join(logsDir, "server-out.log")
    }
  ]
};
