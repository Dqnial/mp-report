import { defineConfig, devices } from '@playwright/test';

/**
 * Сквозные тесты против запущенного стека: бэкенд (с базой и Redis) и собранный
 * фронт в `vite preview` (порт 4173, /api проксируется на бэкенд).
 * Как поднять — docs/development.md; в CI — job `e2e` в deploy.yml.
 */
export default defineConfig({
  testDir: './tests',
  // тесты работают с одной учётной записью и одним шаблоном месяца
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173',
    locale: 'ru-RU',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'mobile-chrome',
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
      // телефон — основной сценарий приложения
      use: {
        ...devices['Pixel 7'],
        // уже вошли (tests/auth.setup.ts); тесты самого входа это отменяют
        storageState: '.auth/user.json',
        // локально можно взять установленный Chrome: E2E_CHANNEL=chrome
        ...(process.env.E2E_CHANNEL && { channel: process.env.E2E_CHANNEL }),
      },
    },
  ],
});
