# syntax=docker/dockerfile:1

# uWebSockets.js prebuilds need GLIBC >= 2.38 (bookworm is 2.36; trixie is fine).
FROM node:22-trixie-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Bake client for local HTTP (no domain). Runtime config.json must keep the same host/apiHost.
RUN cp config.example.json config.json \
  && npm run setup \
  && npm run build \
  && npm prune --omit=dev

FROM node:22-trixie-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/shared ./shared
COPY config.example.json /app/config.example.json
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
  && mkdir -p /app/server/storage

ENV NODE_ENV=production
ENV CONFIG_PATH=/app/config.json
ENV CLIENT_DIST_PATH=/app/client/dist

EXPOSE 9012

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:9012/widget.html').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
