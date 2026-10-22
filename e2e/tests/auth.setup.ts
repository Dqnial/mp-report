import { expect, test as setup } from '@playwright/test';
import { USER } from '../fixtures';

export const STORAGE = '.auth/user.json';

/**
 * Вход один раз на весь прогон: куки сохраняются и подставляются в тесты.
 * Иначе каждый тест входил бы заново и упёрся бы в лимит попыток входа
 * (5 в минуту с одного IP) — он здесь тоже защищает.
 */
setup('вход', async ({ request }) => {
  const res = await request.post('/api/auth/login', {
    data: USER,
    // свой «IP», чтобы не тратить попытки адреса, с которого идут UI-тесты входа
    headers: { 'x-forwarded-for': '10.251.0.1' },
  });
  expect(res.status()).toBe(204);
  await request.storageState({ path: STORAGE });
});
