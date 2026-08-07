# Yobachat — Docker install

Multi-platform chat overlay for OBS. Host needs **Docker only** (no Node/git).

Image: `ghcr.io/antonk777/yobachat:latest` (keep the GHCR package **Public**).

## Setup

```bash
mkdir -p yobachat && cd yobachat
curl -fsSLO https://gist.githubusercontent.com/antonk777/29a033e95acf294dfbbe1030bd863a8a/raw/docker-compose.yml
curl -fsSLO https://gist.githubusercontent.com/antonk777/29a033e95acf294dfbbe1030bd863a8a/raw/config.example.json
cp config.example.json config.json
# edit config.json — adminPassword + platform credentials
# keep host / apiHost as localhost:7777
# twitch.webhookSecret: any random 10+ char string (required by schema; EventSub not used locally)
docker compose up -d
```

Open:

- Widget (OBS): http://localhost:7777/widget.html
- Admin: http://localhost:7777/admin.html

## Update

```bash
curl -fsSLO https://gist.githubusercontent.com/antonk777/29a033e95acf294dfbbe1030bd863a8a/raw/docker-compose.yml
docker compose pull && docker compose up -d
```

Keeps `config.json` and `./data`. Logs: `docker compose logs -f`. Stop: `docker compose down`.

## Security

Never commit real `config.json`. Rotate any leaked bot tokens / OAuth secrets / `adminPassword`.
