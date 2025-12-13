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
  exec_mode: "fork",
  merge_logs: true,
  min_uptime: 10000,
  log_date_format: "YYYY-MM-DD HH:mm:ss Z",
  autorestart: true,
  time: true,
  wait_ready: true,
  restart_delay: 3000
};

const devScript = (process.platform === "win32")
  ? "scripts/pm2-dev-run.cmd"
  : "scripts/pm2-dev-run.sh";

/**
 * PM2 Ecosystem configuration
 * @type {EcosystemFileConfig}
 */
module.exports = {
  apps: [
    {
      ...base,
      script: "dist/index.js",
      cwd: "./server",
      name: "yobachat-prod",
      env: { NODE_ENV: "production" },
      error: path.join(logsDir, "server-error.log"),
      output: path.join(logsDir, "server-out.log")
    },
    {
      ...base,
      name: "yobachat-dev",
      cwd: __dirname,
      script: path.join(__dirname, devScript),
      watch: [
        "scripts/",
        "shared/",
        "server/src/",
        "server/*.json",
        "client/src/",
        "client/*.json"
      ],
      watch_delay: 3000,
      ignore_watch: [
        "node_modules",
        "dist",
        "server/dist",
        "client/dist",
        "logs",
        ".git",
        "*.log"
      ],
      env: { NODE_ENV: "development" },
      error: path.join(logsDir, "server-dev-error.log"),
      output: path.join(logsDir, "server-dev-out.log")
    }
  ]
};

