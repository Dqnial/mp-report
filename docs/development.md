# Локальная разработка

## Что нужно

- Node.js 22
- Docker (для PostgreSQL)
- Для Android — JDK 21 и Android SDK 36 (или Docker-образ `eclipse-temurin:21-jdk`)

## Запуск

```bash
# база: PostgreSQL 16 на порту 5434
cp .env.example .env
docker compose up -d

# бэкенд: http://localhost:3000/api
cd backend
cp .env.example .env          # COOKIE_SECURE=false — куки работают по http
npm ci
npx prisma migrate deploy
npm run user:create -- admin 'пароль-от-8-символов' "Иванов Иван" --admin
npm run start:dev

# фронт: http://localhost:5173, /api проксируется на бэкенд
cd ../frontend
npm ci
npm run dev
```

`npm run user:create` создаёт пользователя или обновляет существующего (сбрасывает его сессии). Остальных удобно добавлять через приглашения на экране «Ещё».

Фронт доступен и с телефона в той же сети по IP компьютера (`host: true`), но «Поделиться» файлом, service worker и `crypto.randomUUID` работают только по HTTPS — их проверяют на сервере или в Chrome на компьютере.

## Проверка офлайн-режима

В `npm run dev` service worker не работает. Собранная версия:

```bash
cd frontend
npm run build && npx vite preview     # http://localhost:4173, тот же прокси /api
```

Дальше в Chrome: DevTools → Network → Offline.

## Команды

| Где | Команда | Что делает |
|---|---|---|
| backend | `npm run start:dev` | API с перезапуском при изменениях |
| backend | `npm test` | тесты Jest |
| backend | `npm run lint` | ESLint |
| backend | `npm run db:migrate` | новая миграция Prisma |
| backend | `npm run user:create -- <логин> <пароль> "<ФИО>" [--admin]` | создать пользователя |
| backend | `npm run template:check -- <файл.xlsx>` | как приложение видит шаблон: дни, план, импорт |
| frontend | `npm run dev` | дев-сервер Vite |
| frontend | `npm run build` | проверка типов и сборка PWA |
| frontend | `npm run lint` | oxlint |
| frontend | `APP_URL=https://… npx cap sync android` | обновить Android-проект |

## Соглашения

- Строгий TypeScript на обеих сторонах, Prettier (одинарные кавычки, запятые в конце).
- Логика Excel — чистые функции, на каждое правило раскладки есть тест.
- Реальные Excel-файлы и дампы базы с персональными данными держать вне репозитория: папка `samples/`, `*.xlsx` и `*.dump` в `.gitignore`.
