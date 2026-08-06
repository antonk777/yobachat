#!/usr/bin/env bash
# Production update: pull the latest image and recreate the container.
# Needs only Docker (and this compose project dir with config.json).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() {
  echo "[docker-sync] $*"
}

die() {
  echo "[docker-sync] $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || die "docker is required"
[[ -f config.json ]] || die "Missing config.json — copy config.example.json to config.json and fill credentials"
[[ -f docker-compose.yml ]] || die "Missing docker-compose.yml"

log "Pulling image..."
docker compose pull

log "Starting / recreating stack..."
docker compose up -d --remove-orphans

log "Done. Widget: http://localhost:9012/widget.html  Admin: http://localhost:9012/admin.html"
