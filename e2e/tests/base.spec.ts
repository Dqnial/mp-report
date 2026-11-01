import JSZip from 'jszip';
import { expect, test } from '@playwright/test';
import {
  makeBase,
  makeTemplate,
  openApp,
  today,
  unique,
  uniqueWord,
  uploadTemplate,
} from '../fixtures';

test('база врачей и аптек: файл руководителя → врачи из визитов, без удалённых', async ({
  page,
}) => {
  // визит к новому врачу — справочник пополнится на сервере
  const visit = async (fullName: string) => {
    const id = `e2e-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const put = await page.request.put(`/api/visits/sync/${id}`, {
      data: {
        clientId: id,
        date: today(),
        kind: 'DOCTOR',
        placeName: 'Клиника Базовая',
        fullName,
        specialty: 'ВОП',
        products: [{ code: 'LAXSID' }],
        updatedAt: new Date().toISOString(),
      },
    });
    expect(put.ok()).toBe(true);
    return id;
  };
  // уникальная часть — в фамилии: третьим словом её сочли бы отчеством,
  // и база свела бы врачей разных прогонов в одного (отчество с опечаткой)
  const tag = uniqueWord();
  const name = `Базова${tag} Анна`;
  await visit(name);
  // ошибочный визит удалили — врач остаётся в справочнике, но не в базе
  const mistake = `Ошибочная${tag} Ольга`;
  const removed = await page.request.delete(
    `/api/visits/sync/${await visit(mistake)}?updatedAt=${encodeURIComponent(new Date().toISOString())}`,
  );
  expect(removed.ok()).toBe(true);

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
  // пример руководителя заменён, врача из удалённого визита нет
  expect(sheet).not.toContain('Образцова Ольга Петровна');
  expect(sheet).not.toContain(mistake);
});

test('врач, вписанный в Excel до приложения: в базе, в поиске и в справочнике', async ({
  page,
}) => {
  const day = today().endsWith('-01') ? 2 : 1;
  const tag = uniqueWord();
  const name = `Экселева${tag} Галина`;
  // заполненный отчёт: строка с ФИО и комментарием — визит «из файла»
  await uploadTemplate(
    page.request,
    await makeTemplate({ day, fullName: name }),
  );
  const base = await page.request.post('/api/base/template', {
    multipart: { file: await makeBase() },
  });
  expect(base.ok()).toBe(true);

  // база
  const file = await page.request.get('/api/base/file');
  const sheet = await (
    await JSZip.loadAsync(await file.body())
  )
    .file('xl/worksheets/sheet1.xml')!
    .async('string');
  expect(sheet).toContain(name);

  // поиск по всем визитам
  await openApp(page);
  await page.goto('/search');
  await page.getByText('Все визиты', { exact: true }).click();
  await page
    .getByPlaceholder('ФИО, ЛПУ, аптека, телефон…')
    .fill(`Экселева${tag}`);
  await expect(page.getByText(name)).toBeVisible();
  // поиск за месяц (из памяти телефона)
  await page.getByText('Месяц', { exact: true }).click();
  await expect(page.getByText(name)).toBeVisible();
  // в Excel телефон не вписали — фильтр «Чего-то не хватает» его находит,
  // в карточке видно, что дописать
  await page.getByText('Чего-то не хватает', { exact: true }).click();
  const card = page.locator('a', { hasText: name });
  await expect(card).toBeVisible();
  await expect(card.getByText('нет телефона')).toBeVisible();

  // справочник
  await page.goto('/more/directory');
  await page.getByPlaceholder('ФИО, ЛПУ, адрес или телефон').fill(name);
  await expect(page.getByText(name)).toBeVisible();
});
