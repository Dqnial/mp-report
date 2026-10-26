# Локальная разработка

## Что нужно

- Node.js 22
- Docker (PostgreSQL и Redis)
- Для Android — JDK 21 и Android SDK 36 (или Docker-образ `eclipse-temurin:21-jdk`)

## Запуск

```bash
# база PostgreSQL на порту 5434 и Redis на 6380
cp .env.example .env
docker compose up -d

# бэкенд: http://localhost:3000/api
cd backend
cp .env.example .env          # COOKIE_SECURE=false — куки по http; REDIS_URL; SWAGGER=true
npm ci
npx prisma migrate deploy
npm run user:create -- admin 'пароль-от-8-символов' "Иванов Иван" --admin
npm run start:dev

# фронт: http://localhost:5173, /api проксируется на бэкенд
cd ../frontend
npm ci
npm run dev
```

Документация API — http://localhost:3000/api/docs (Swagger).

Redis необязателен: без `REDIS_URL` бэкенд работает в упрощённом режиме (импорт шаблона сразу в запросе, лимит входа в памяти, без кеша отчёта) — см. [redis-queues.md](redis-queues.md).

`npm run user:create` создаёт пользователя или обновляет существующего (сбрасывает его сессии). Остальных удобно добавлять через приглашения на экране «Ещё».

Фронт доступен и с телефона в той же сети по IP компьютера (`host: true`), но «Поделиться» файлом, service worker и `crypto.randomUUID` работают только по HTTPS — их проверяют на сервере или в Chrome на компьютере.

## Проверка офлайн-режима

В `npm run dev` service worker не работает. Собранная версия:

```bash
cd frontend
npm run build && npx vite preview     # http://localhost:4173, тот же прокси /api
```

Дальше в Chrome: DevTools → Network → Offline.

## Сквозные тесты (Playwright)

Нужен запущенный стек: бэкенд (с базой и Redis) и собранный фронт в `vite preview`.

```bash
cd backend && npm run user:create -- e2e e2e-password-1 "Тестовый Пользователь"
cd ../frontend && npm run build && npx vite preview --port 4173
cd ../e2e && npm ci
npx playwright install chromium        # или E2E_CHANNEL=chrome — взять установленный Chrome
npx playwright test
```

Тесты входят один раз (`tests/auth.setup.ts`) и переиспользуют сессию — иначе упёрлись бы в лимит попыток входа. Шаблон Excel тесты собирают сами (вымышленный, на текущий месяц, `fixtures.ts`), реальные файлы не нужны. Тесты устойчивы к повторным прогонам на той же базе.

## Команды

| Где | Команда | Что делает |
|---|---|---|
| backend | `npm run start:dev` | API с перезапуском при изменениях |
| backend | `npm test` | юнит-тесты Jest (98) |
| backend | `npm run lint` | ESLint |
| backend | `npm run db:migrate` | новая миграция Prisma |
| backend | `npm run user:create -- <логин> <пароль> "<ФИО>" [--admin]` | создать пользователя |
| backend | `npm run template:check -- <файл.xlsx>` | как приложение видит шаблон: дни, план, импорт |
| frontend | `npm run dev` | дев-сервер Vite |
| frontend | `npm run build` | проверка типов и сборка PWA |
| frontend | `npm run lint` | oxlint |
| frontend | `APP_URL=https://… npx cap sync android` | обновить Android-проект |
| e2e | `npx playwright test` | сквозные тесты (10) |
| e2e | `npx playwright show-report` | отчёт последнего прогона |

## Соглашения

- Строгий TypeScript на обеих сторонах, Prettier (одинарные кавычки, запятые в конце).
- Логика Excel — чистые функции, на каждое правило раскладки есть тест.
- Реальные Excel-файлы и дампы базы с персональными данными держать вне репозитория: папка `samples/`, `*.xlsx` и `*.dump` в `.gitignore`.
