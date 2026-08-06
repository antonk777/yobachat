# Yobachat

Multi-platform chat overlay for OBS with a web admin panel. Runs locally over HTTP (no domain) via Docker or `npm run dev`.

## Features

- Platforms: Twitch, YouTube Live, Telegram, VK Video, Kick, GoodGame
- WebSocket overlay + admin console
- Local admin (auto JWT when `secure: false` — no Twitch login)

## Quick start (Docker)

```bash
cp config.example.json config.json
# edit config.json — keep host/apiHost as localhost:3900 and secure: false
docker compose up -d --build
```

Open:

- Widget (OBS): http://localhost:3900/widget.html
- Admin: http://localhost:3900/admin.html

Logs: `docker compose logs -f`  
Stop: `docker compose down`

Persistent data is stored in `./data` (mounted to `server/storage`).

## Config

Single file: `config.json` (from `config.example.json`). Never commit secrets.

Important for local Docker:

- `host` / `apiHost`: `localhost:3900`
- `secure`: `false`
- Internal ports `apiPort` / `wsPort` / `webhookPort` should stay `9012` / `9013` / `9014` (nginx in the image proxies them)

Set `CONFIG_PATH` to override the config file path.

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
| `npm run start` | Run built server (static files need a reverse proxy) |
| `npm run docker:up` | Build and start Compose stack |
| `npm run docker:down` | Stop stack |
| `npm run docker:logs` | Follow container logs |

## Project structure

```
.
├── client/           # Vue 3 widget + admin
├── server/           # Node ingestion + WebSocket + API
├── shared/           # Shared types/helpers
├── docker/           # nginx + entrypoint
├── config.example.json
├── Dockerfile
└── docker-compose.yml
```

## License

MIT
