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
 * Common options shared by both environments
 * @type {Partial<StartOptions>}
 */
const base = {
  script: "dist/index.js",
  cwd: "./server",
  exec_mode: "fork",
  merge_logs: true,
  min_uptime: 10000,
  log_date_format: "YYYY-MM-DD HH:mm:ss Z",
  time: true,
  // wait_ready: true,
  restart_delay: 3000
};

/**
 * PM2 Ecosystem configuration
 * @type {EcosystemFileConfig}
 */
module.exports = {
  apps: [
    {
      ...base,
      name: "yobachat-prod",
      env: {
        NODE_ENV: "production",
        SHARED_CONFIG_PATH: path.resolve(__dirname, "shared", "shared-config.prod.json"),
        SERVER_CONFIG_PATH: path.resolve(__dirname, "server", "server-config.prod.json")
      },
      autorestart: true,
      error: path.join(logsDir, "server-error.log"),
      output: path.join(logsDir, "server-out.log")
    },
    {
      ...base,
      name: "yobachat-dev",
      env: {
        NODE_ENV: "development",
        SHARED_CONFIG_PATH: path.resolve(__dirname, "shared", "shared-config.dev.json"),
        SERVER_CONFIG_PATH: path.resolve(__dirname, "server", "server-config.dev.json")
      },
      watch: [
        "dist/index.js",
        "shared/**/*.json"
      ],
      watch_delay: 3000,
      error: path.join(logsDir, "server-dev-error.log"),
      output: path.join(logsDir, "server-dev-out.log")
    }
  ]
};

