#!/bin/sh
set -eu

if [ ! -f /app/config.json ]; then
  echo "Missing /app/config.json — copy config.example.json to config.json and fill credentials"
  exit 1
fi

mkdir -p "${STORAGE_PATH:-/storage}"

cd /app/server
exec env CONFIG_PATH=/app/config.json CLIENT_DIST_PATH=/app/client/dist STORAGE_PATH="${STORAGE_PATH:-/storage}" NODE_ENV=production node dist/index.js
