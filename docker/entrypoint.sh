#!/bin/sh
set -eu

if [ ! -f /app/config.json ]; then
  echo "Missing /app/config.json — copy config.example.json to config.json and fill credentials"
  exit 1
fi

cd /app/server
CONFIG_PATH=/app/config.json NODE_ENV=production node dist/index.js &
NODE_PID=$!

cleanup() {
  kill "$NODE_PID" "$NGINX_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Wait until the API port accepts connections
i=0
while [ "$i" -lt 60 ]; do
  if node -e "require('net').connect(9012,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    echo "Chat server exited before becoming ready"
    wait "$NODE_PID" || true
    exit 1
  fi
  i=$((i + 1))
  sleep 0.5
done

nginx -g 'daemon off;' &
NGINX_PID=$!

while true; do
  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    echo "Chat server exited"
    kill "$NGINX_PID" 2>/dev/null || true
    wait "$NODE_PID" || true
    exit 1
  fi
  if ! kill -0 "$NGINX_PID" 2>/dev/null; then
    echo "nginx exited"
    kill "$NODE_PID" 2>/dev/null || true
    wait "$NGINX_PID" || true
    exit 1
  fi
  sleep 2
done
