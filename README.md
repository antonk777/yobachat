# Yobachat

Multi-platform chat overlay for OBS with a web admin panel. The server aggregates chat from multiple platforms, pushes it over WebSocket, and the Vue client renders both the public widget and an admin console.

## Features

- Platforms: Twitch, YouTube Live, Telegram (webhook or polling), VK Video, Kick, GoodGame
- BetterTTV: loads global and channel emotes (optional)
- WebSocket overlay: lightweight uWebSockets server with typed messages
- Admin console: delete/clear messages, toggle settings, refresh BetterTTV emotes
- Console output modes: fully headless console mode or mirrored console logging while WebSocket stays on

## Project Structure

```
.
├── server/           # Node.js + TypeScript ingestion + WebSocket + webhooks
├── client/           # Vue 3 + Vite widget (widget.html) and admin (admin.html)
├── shared/           # Shared types/config used by server and client
├── scripts/          # Utilities (symlink setup)
└── ecosystem.config.cjs # PM2 definitions
```

## Prerequisites

- Node.js 20+ and npm
- pm2 (optional, for prod: `npm install -g pm2`)

## Install

```bash
npm install
npm run dev:setup   # copies *.dev.json configs + creates client/shared and server/shared symlinks
```

## Configuration

Configuration is JSON-driven. Copy the examples and fill in your values (never commit secrets):

```bash
npm run dev:setup
# or manually:
cp server/server-config.example.json server/server-config.dev.json
cp shared/shared-config.example.json shared/shared-config.dev.json
```

- `shared/shared-config*.json`
  - `host`: public host serving the widget/admin static files
  - `apiHost`: public host (or host:port) that terminates TLS and proxies WebSocket traffic to the server
  - `basePath`: sub-path where the widget/admin are hosted (e.g. "/" or "/chat/")
  - `wsPath`: WebSocket path (e.g. "/ws/"); must match your reverse-proxy route to the server `wsPort`

- `server/server-config*.json`
  - `consoleMode`: true disables WebSocket and only prints chat to stdout
  - `enableConsoleOutput`: mirror messages to stdout while WebSocket stays enabled
  - `apiPort`, `wsPort`, `webhookPort`, `webhookPath`: internal listener ports/paths (proxy externally as needed)
  - Platform configs: credentials and channel IDs for twitch, youtube (API key + `pollInterval` ms), telegram (`botToken`, `chatId`, mode `webhook|polling` for webhook, `pollInterval`), vkvideo, kick, goodgame
  - `betterttv`: `channelId`, `includeGlobal`, `includeChannel`, `color`
  - `platforms`: the list that drives badges/colors in the widget; ids must match the platform keys above

Development scripts already point at `server/server-config.dev.json` and `shared/shared-config.dev.json`. Set `SERVER_CONFIG_PATH` and `SHARED_CONFIG_PATH` to override paths for any command.

## Building & Running

### Development

On Windows (and other platforms), use the local dev workflow:

```bash
npm install
npm run dev:setup          # create shared-config.dev.json + server-config.dev.json
# edit server/server-config.dev.json with your platform credentials
npm run dev:local          # build, start server, and run the local dev proxy
```

`dev:local` serves the built client and proxies API/WebSocket traffic through `http://localhost:3900` (see `shared/shared-config.dev.json`). Open:

- Widget: `http://localhost:3900/widget.html`
- Admin: `http://localhost:3900/admin.html`

If that port is taken, change `host` and `apiHost` in `shared/shared-config.dev.json`, rebuild the client (`npm run dev:build:client`), then restart.

For OBS, point a Browser Source at the widget URL above.

For admin login locally, add this Twitch OAuth redirect URL in your Twitch developer app:

`http://localhost:3900/auth/twitch/callback`

`dev:local` runs setup, builds, server, and proxy in a single Node process (`scripts/dev-local.ts`). It watches for changes: the client rebuilds via `vite build --watch` (refresh the browser to pick up changes), and the server rebuilds via `esbuild --watch` and is automatically restarted in-process when its bundle changes.

### Production

```bash
SHARED_CONFIG_PATH=./shared/shared-config.json \
SERVER_CONFIG_PATH=./server/server-config.json \
npm run prod:build:all

npm run prod:pm2:start   # start via PM2 (uses ecosystem.config.cjs)
# pm2 helpers: prod:pm2:restart, prod:pm2:logs, prod:pm2:stop, prod:pm2:delete
```

- Reverse proxy `https://<apiHost><basePath><wsPath>` to `ws://localhost:<wsPort><wsPath>`.
- Serve `client/dist` at `https://<host>/<basePath>`. `widget.html` is the OBS overlay; `admin.html` is the control panel.
- Telegram webhook target: `https://<apiHost>/<webhookPath>` (proxy to `webhookPort`).

## OBS Quickstart

- Build client and start server (dev or prod as above).
- In OBS, add a Browser Source pointing at `https://<host>/<basePath>widget.html`.
- Size and style via your scene; chat badges/colors come from `platforms` in the server config.

## Console Modes

- `consoleMode: true`: WebSocket disabled; all messages printed with colored badges.
- `enableConsoleOutput: true`: keep WebSocket running but also mirror messages to stdout.

## License

MIT

