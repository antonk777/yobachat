import { defineApp } from 'pm2-ecosystem';


const serverApp = defineApp({
  name: "yobachat-server-prod",
  script: "dist/index.js",
  cwd: "./server",
  exec_mode: "fork",
  watch: false,
  env: {
    NODE_ENV: "production"
  },
  error: "../logs/server-error.log",
  output: "../logs/server-out.log",
  log_date_format: "YYYY-MM-DD HH:mm:ss Z",
  merge_logs: true,
  autorestart: true,
  min_uptime: 10000
});

const serverDevApp = defineApp({
  name: "yobachat-server-dev",
  script: "dist/index.js",
  cwd: "./server",
  exec_mode: "fork",
  watch: [
    "server/src",
    "server/shared"
  ],
  ignore_watch: [
    "node_modules",
    "dist",
    "logs",
    ".git",
    "*.log"
  ],
  env: {
    NODE_ENV: "development"
  },
  args: [
    "--server-config ./server-config.dev.json",
    "--shared-config ./shared/shared-config.dev.json"
  ],
  error: "../logs/server-dev-error.log",
  output: "../logs/server-dev-out.log",
  log_date_format: "YYYY-MM-DD HH:mm:ss Z",
  merge_logs: true,
  autorestart: true,
  min_uptime: 10000
});

export default {
  apps: [ serverApp, serverDevApp ]
};
