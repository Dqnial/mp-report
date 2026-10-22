import { expect, test } from '@playwright/test';
import { login, USER } from '../fixtures';

// здесь проверяем сам вход — без сохранённой сессии и со своим «IP» на прогон,
// чтобы повторные прогоны подряд не упирались в лимит попыток входа
const runIp = `10.252.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
test.use({
  storageState: { cookies: [], origins: [] },
  extraHTTPHeaders: { 'x-forwarded-for': runIp },
});

test('неверный пароль — понятная ошибка, вход не выполнен', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Логин').fill(USER.login);
  await page.getByLabel('Пароль').fill('совсем-не-тот-пароль');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('вход → экран «Сегодня» → выход на экран входа', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible();

  await page.getByRole('link', { name: 'Ещё' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('подбор пароля: после 5 неверных попыток — 429 и пауза', async ({
  playwright,
  baseURL,
}) => {
  // свой «IP» для теста: бэкенд берёт адрес клиента из X-Forwarded-For,
  // доверяя только прокси в своей сети (здесь — vite preview на localhost)
  const ip = `10.250.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const api = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-forwarded-for': ip },
  });
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await api.post('/api/auth/login', {
      data: { login: USER.login, password: 'неверный-пароль' },
    });
    statuses.push(r.status());
  }
  expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);

  const blocked = await api.post('/api/auth/login', {
    data: { login: USER.login, password: USER.password },
  });
  // даже верный пароль — только после паузы
  expect(blocked.status()).toBe(429);
  expect((await blocked.json()).message).toContain('Слишком много попыток');
  await api.dispose();
});
