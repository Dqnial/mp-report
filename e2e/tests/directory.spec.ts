import JSZip from 'jszip';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  makeBase,
  makeTemplate,
  openApp,
  today,
  unique,
  uploadTemplate,
} from '../fixtures';

/** Строки листа врачей готовой базы (первый лист файла). */
async function baseDoctors(request: APIRequestContext) {
  const file = await request.get('/api/base/file');
  expect(file.status()).toBe(200);
  return (await JSZip.loadAsync(await file.body()))
    .file('xl/worksheets/sheet1.xml')!
    .async('string');
}

test('справочник: исправить ФИО и потенциал — исправляются визит месяца и база; «не в базе» убирает строку', async ({
  page,
}) => {
  await page.request.post('/api/base/template', {
    multipart: { file: await makeBase() },
  });
  const typo = unique('Опечаткина Анна');
  const fixed = typo.replace('Опечаткина', 'Исправлена');
  const id = `e2e-${Date.now().toString(36)}`;
  const put = await page.request.put(`/api/visits/sync/${id}`, {
    data: {
      clientId: id,
      date: today(),
      kind: 'DOCTOR',
      placeName: 'Клиника Справочная',
      fullName: typo,
      products: [],
      updatedAt: new Date().toISOString(),
    },
  });
  expect(put.ok()).toBe(true);

  await openApp(page);
  await page.getByRole('link', { name: 'Ещё', exact: true }).click();
  await page.getByRole('link', { name: 'Справочник врачей и аптек' }).click();
  await page.getByPlaceholder('ФИО, ЛПУ, адрес или телефон').fill(typo);
  await page.getByText(typo).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'ФИО' }).fill(fixed);
  await dialog.getByRole('button', { name: 'Высокий' }).click();
  await expect(
    dialog.getByRole('checkbox', {
      name: 'Исправить и в визитах этого месяца',
    }),
  ).toBeChecked();
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(
    page.getByText('Сохранено. Исправлено визитов в этом месяце: 1'),
  ).toBeVisible();

  // визит на сервере — с исправленным ФИО
  const found = await page.request.get(
    '/api/visits/search?q=' + encodeURIComponent(fixed),
  );
  expect((await found.json()).visits).toHaveLength(1);

  // в базе — исправленное ФИО и потенциал
  const row = (await baseDoctors(page.request))
    .match(/<row\b[\s\S]*?<\/row>/g)!
    .find((r) => r.includes(fixed));
  expect(row).toContain('Высокий');

  // «не включать в базу» — строки больше нет
  await page.getByPlaceholder('ФИО, ЛПУ, адрес или телефон').fill(fixed);
  await page.getByText(fixed).click();
  await page
    .getByRole('switch', { name: 'Включать в базу врачей и аптек' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Сохранить' })
    .click();
  await expect(page.getByText('не в базе')).toBeVisible();
  expect(await baseDoctors(page.request)).not.toContain(fixed);
});

test('визит из файла: исправление переписывает его строку в отчёте и переживает повторную загрузку шаблона', async ({
  page,
}) => {
  const month = today().slice(0, 7);
  const day = today().endsWith('-01') ? 2 : 1;
  const date = `${month}-${String(day).padStart(2, '0')}`;
  const inFile = unique('Файлова Ольга');
  const fixed = inFile.replace('Файлова', 'Исправленная');
  const template = await makeTemplate({ day, fullName: inFile });
  await uploadTemplate(page.request, template);

  await openApp(page);
  await page.goto(`/day/${date}`);
  await page.getByText(inFile).click();
  await expect(page.getByText(/Визит из файла отчёта/)).toBeVisible();
  await page.getByRole('combobox', { name: 'ФИО врача' }).fill(fixed);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText(fixed)).toBeVisible();
  await expect(page.getByText('Всё на сервере')).toBeVisible();

  const reportSheet = async () =>
    (
      await JSZip.loadAsync(
        await (await page.request.get(`/api/reports/${month}`)).body(),
      )
    )
      .file('xl/worksheets/sheet1.xml')!
      .async('string');
  let sheet = await reportSheet();
  expect(sheet).toContain(fixed);
  expect(sheet).not.toContain(inFile);

  // тот же файл ещё раз — правка не затирается, визит не задваивается
  await uploadTemplate(page.request, template);
  const found = await page.request.get(
    '/api/visits/search?q=' + encodeURIComponent(fixed),
  );
  const visits = (await found.json()).visits as { fromFile: boolean }[];
  expect(visits).toHaveLength(1);
  expect(visits[0].fromFile).toBe(true);
  sheet = await reportSheet();
  expect(sheet).toContain(fixed);
  expect(sheet).not.toContain(inFile);
});
