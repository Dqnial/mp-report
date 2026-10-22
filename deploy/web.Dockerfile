# Фронт (PWA) + Caddy: раздаёт приложение, проксирует /api на бэкенд,
# сам получает и продлевает HTTPS-сертификат (Let's Encrypt).
# статика не зависит от архитектуры — собираем на платформе сборщика (без эмуляции)
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
