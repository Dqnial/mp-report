import JSZip from 'jszip';
import { expect, test } from '@playwright/test';
import { makeBase, openApp, today, unique } from '../fixtures';

test('база врачей и аптек: файл руководителя → врач из визита в готовой базе', async ({
  page,
}) => {
  // визит к новому врачу — справочник пополнится на сервере
  const name = unique('Базова Анна');
  const id = `e2e-${Date.now().toString(36)}`;
  const put = await page.request.put(`/api/visits/sync/${id}`, {
    data: {
      clientId: id,
      date: today(),
      kind: 'DOCTOR',
      placeName: 'Клиника Базовая',
      fullName: name,
      specialty: 'ВОП',
      products: [{ code: 'LAXSID' }],
      updatedAt: new Date().toISOString(),
    },
  });
  expect(put.ok()).toBe(true);

  await openApp(page);
  await page.getByRole('link', { name: 'Ещё', exact: true }).click();
  await page.getByRole('link', { name: 'База врачей и аптек' }).click();

  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: /Загрузить файл базы|Заменить файл/ })
    .click();
  await (await chooser).setFiles(await makeBase());
  await expect(page.getByText('Нашёл листы врачей и аптек')).toBeVisible();
  await expect(page.getByText(/В базу попадут: врачей — \d+/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Отправить базу' }),
  ).toBeEnabled();

  // в файле — тот самый врач, с МП, городом из шапки и препаратом
  const file = await page.request.get('/api/base/file');
  expect(file.status()).toBe(200);
  const sheet = await (
    await JSZip.loadAsync(await file.body())
  )
    .file('xl/worksheets/sheet1.xml')!
    .async('string');
  const row = sheet
    .match(/<row\b[\s\S]*?<\/row>/g)!
    .find((r) => r.includes(name))!;
  expect(row).toContain('Клиника Базовая');
  expect(row).toContain('Тестоград');
  expect(row).toContain('Лаксид');
  // пример руководителя заменён
  expect(sheet).not.toContain('Образцова Ольга Петровна');
});
