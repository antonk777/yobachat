# Yobachat

Multi-platform chat overlay for OBS with a web admin panel. Runs locally over HTTP (no domain) via Docker or `npm run dev`.

## Features

- Platforms: Twitch, YouTube Live, Telegram, VK Video, Kick, GoodGame
- WebSocket overlay + admin console
- Local admin via password (`adminPassword` in config)

## Quick start (Docker)

```bash
cp config.example.json config.json
# edit config.json — keep host/apiHost as localhost:3900
docker compose up -d --build
```

Open:

- Widget (OBS): http://localhost:3900/widget.html
- Admin: http://localhost:3900/admin.html

Logs: `docker compose logs -f`  
Stop: `docker compose down`

Persistent data is stored in `./data` (mounted to `server/storage`).

Compose maps host `3900` → container `apiPort` (`9012`). Express serves the client and proxies `/ws/` and `/webhook/` internally.

## Config

Single file: `config.json` (from `config.example.json`). Never commit secrets.

Important for local use:

- `host` / `apiHost`: `localhost:3900`
- `adminPassword`: password for the admin panel login
- `apiPort`: `9012` (public HTTP inside the container / for `npm start`)
- `wsPort` / `webhookPort`: internal only (`9013` / `9014`)

Set `CONFIG_PATH` to override the config file path. Set `CLIENT_DIST_PATH` if the built client is not next to the server.

## Local development (without Docker)

```bash
npm install
npm run setup          # creates config.json + shared symlinks
# edit config.json
npm run dev            # build + watch + proxy on :3900
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run setup` | Create `config.json` and shared symlinks |
| `npm run dev` | Local watch/dev proxy |
| `npm run build` | Build server + client |
| `npm run start` | Run built server (serves `client/dist` when present) |
| `npm run docker:up` | Build and start Compose stack |
| `npm run docker:down` | Stop stack |
| `npm run docker:logs` | Follow container logs |

## Project structure

```
.
├── client/           # Vue 3 widget + admin
├── server/           # Node ingestion + WebSocket + API + static
├── shared/           # Shared types/helpers
├── docker/           # container entrypoint
├── config.example.json
├── Dockerfile
└── docker-compose.yml
```

## License

MIT
