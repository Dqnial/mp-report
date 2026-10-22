# Бэкенд для прода. Собирает GitHub Actions под linux/amd64 и linux/arm64
# (серверы бывают x86 и ARM); prisma generate внутри образа подтягивает
# движок под платформу образа.
FROM node:22-bookworm-slim

# openssl — для Prisma; python3/make/g++ — на случай, если bcrypt придётся собрать из исходников
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
# dev-зависимости оставляем: нужны ts-node для `npm run user:create` и prisma CLI для миграций
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# миграции применяются при каждом старте (безопасно: применяет только новые)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
