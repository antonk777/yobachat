# Yobachat

Multi-platform chat overlay for OBS with a web admin panel. Runs locally over HTTP (no domain) via Docker or `npm run dev`.

## Features

- Platforms: Twitch, YouTube Live, Telegram, VK Video, Kick, GoodGame
- WebSocket overlay + admin console
- Local admin via password (`adminPassword` in config)

## Production (Docker only)

On the host you only need **Docker**. No Node, no git.

1. Download Compose and the example config into an empty directory:

```bash
mkdir -p yobachat && cd yobachat
curl -fsSLO https://raw.githubusercontent.com/antonk777/yobachat/main/docker-compose.yml && curl -fsSLO https://raw.githubusercontent.com/antonk777/yobachat/main/config.example.json && cp config.example.json config.json
```

2. Edit `config.json` — set `adminPassword` and your platform credentials. Keep `host` / `apiHost` as `localhost:7777`.

3. Start:

```bash
docker compose up -d
```

Images are published by GitHub Actions on push to `main` (no PAT). After the first successful run, set the GHCR package to **Public** if needed so pulls need no login.

Open:

- Widget (OBS): http://localhost:7777/widget.html
- Admin: http://localhost:7777/admin.html

### Update

From the same directory (keeps your `config.json` and `./storage`):

```bash
# optional: refresh Compose if it changed upstream
curl -fsSLO https://raw.githubusercontent.com/antonk777/yobachat/main/docker-compose.yml && docker compose pull && docker compose up -d
```

That pulls the latest `ghcr.io/antonk777/yobachat:latest` image and recreates the container. Your config and stored data are untouched.

Logs: `docker compose logs -f`  
Stop: `docker compose down`  
Persistent data on the host:

- `./config.json` — credentials (bind-mounted read-only)
- `./storage/` — settings, message history, deleted messages (`STORAGE_PATH=/storage` in the container)

Image: `ghcr.io/antonk777/yobachat:latest`.

## Local Docker build

```bash
cp config.example.json config.json
# edit config.json
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## Config

Single file: `config.json` (from `config.example.json`). Never commit secrets.

Important for local use:

- `host` / `apiHost`: `localhost:7777` (Docker published port)
- `adminPassword`: password for the admin panel login
- `apiPort`: `9012` (HTTP inside the container / for `npm start`)
- `wsPort` / `webhookPort`: internal only (`9013` / `9014`)

Set `CONFIG_PATH` to override the config file path. Set `CLIENT_DIST_PATH` if the built client is not next to the server. Set `STORAGE_PATH` to override where settings/history are stored (default: repo `./storage`, Docker: `/storage`).

## Local development (without Docker)

```bash
npm install
npm run setup          # creates config.json + shared symlinks
# edit config.json
npm run dev            # build + watch; open host from config (Docker: :7777, local often :9012)
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run setup` | Create `config.json` and shared symlinks |
| `npm run dev` | Local watch/dev proxy |
| `npm run build` | Build server + client |
| `npm run start` | Run built server (serves `client/dist` when present) |
| `npm run docker:up` | Local: build image and start Compose |
| `docker compose up -d` | Production: run (after curl compose + edit config.json) |
| `./scripts/docker-sync.sh` | Pull latest image and recreate |
| `npm run docker:down` | Stop stack |
| `npm run docker:logs` | Follow container logs |

## Project structure

```
.
├── client/           # Vue 3 widget + admin
├── server/           # Node ingestion + WebSocket + API + static
├── shared/           # Shared types/helpers
├── docker/           # container entrypoint
├── storage/          # settings, message history (host-persisted; Docker → /storage)
├── config.example.json
├── Dockerfile
├── docker-compose.yml       # production (pull image)
└── docker-compose.build.yml # local build override
```

## License

MIT
