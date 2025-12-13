#!/bin/bash
set -e
npm run build:all:dev
exec node server/dist/index.js --server-config ./server-config.dev.json --shared-config ./shared/shared-config.dev.json
