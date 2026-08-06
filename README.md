# Yobachat

Multi-platform chat overlay for OBS with a web admin panel. Runs locally over HTTP (no domain) via Docker or `npm run dev`.

## Features

- Platforms: Twitch, YouTube Live, Telegram, VK Video, Kick, GoodGame
- WebSocket overlay + admin console
- Local admin via password (`adminPassword` in config)

## Production (Docker only)

On the host you only need **Docker**. No Node, no git.

```bash
mkdir -p yobachat/data && cd yobachat
curl -fsSLO https://raw.githubusercontent.com/antonk777/yobachat/main/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/antonk777/yobachat/main/config.example.json
cp config.example.json config.json
# edit config.json — keep host/apiHost as localhost:9012; set adminPassword + platform credentials
docker compose up -d
```

Images are published by GitHub Actions on push to `main` (no PAT on your machine). After the first successful run, set the GHCR package to **Public** if needed so pulls need no login.

Open:

- Widget (OBS): http://localhost:9012/widget.html
- Admin: http://localhost:9012/admin.html

Update to the latest image:

```bash
docker compose pull && docker compose up -d
# or, if you have the repo/scripts: ./scripts/docker-sync.sh
```

Logs: `docker compose logs -f`  
Stop: `docker compose down`

Persistent data is in `./data` (mounted to `server/storage`). Image: `ghcr.io/antonk777/yobachat:latest` (override with `YOBACHAT_IMAGE`).

## Local Docker build

```bash
cp config.example.json config.json
# edit config.json
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## Config

Single file: `config.json` (from `config.example.json`). Never commit secrets.

Important for local use:

- `host` / `apiHost`: `localhost:9012`
- `adminPassword`: password for the admin panel login
- `apiPort`: `9012` (HTTP for Docker / `npm start`)
- `wsPort` / `webhookPort`: internal only (`9013` / `9014`)

Set `CONFIG_PATH` to override the config file path. Set `CLIENT_DIST_PATH` if the built client is not next to the server.

## Local development (without Docker)

```bash
npm install
npm run setup          # creates config.json + shared symlinks
# edit config.json
npm run dev            # build + watch + proxy on :9012
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run setup` | Create `config.json` and shared symlinks |
| `npm run dev` | Local watch/dev proxy |
| `npm run build` | Build server + client |
| `npm run start` | Run built server (serves `client/dist` when present) |
| `npm run docker:up` | Local: build image and start Compose |
| `docker compose pull && docker compose up -d` | Production: pull and run (Docker only) |
| `./scripts/docker-sync.sh` | Same as production update |
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
├── docker-compose.yml       # production (pull image)
└── docker-compose.build.yml # local build override
```

## License

MIT
