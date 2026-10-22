import { expect, test } from '@playwright/test';
import { makeTemplate, openApp, today, unique } from '../fixtures';

test('шаблон → план дня → визит по плану → предпросмотр и готовый xlsx', async ({
  page,
}) => {
  await openApp(page);
  const month = today().slice(0, 7);

  // загрузка шаблона через экран «Отчёт» (поле выбора файла)
  const template = await makeTemplate();
  await page.getByRole('link', { name: 'Отчёт' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: /Загрузить шаблон|Заменить шаблон/ })
    .click();
  await (await chooser).setFiles(template);
  await expect(page.getByText(/Шаблон на .* загружен/)).toBeVisible();

  // план дня из шаблона и визит в запланированное ЛПУ через «+»
  await page.getByRole('link', { name: 'Визиты' }).click();
  await expect(page.getByRole('button', { name: /^По плану/ })).toBeVisible();
  // первая — группа плана (после прошлых прогонов ниже бывает и группа
  // «не по плану» с тем же названием, когда строки плана заполнены)
  await page
    .getByRole('link', { name: 'Визит: Городская поликлиника №3' })
    .first()
    .click();
  await expect(page.getByRole('combobox', { name: 'ЛПУ' })).toHaveValue(
    'Городская поликлиника №3',
  );
  const name = unique('Плановый Олег');
  await page.getByRole('combobox', { name: 'ФИО врача' }).fill(name);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText('Всё на сервере')).toBeVisible();

  // предпросмотр: визит — в строке группы своего ЛПУ, «из приложения»
  await page.goto(`/report/preview?date=${today()}`);
  const row = page.locator('a', { hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText('из приложения')).toBeVisible();

  // готовый файл — под исходным именем
  const file = await page.request.get(`/api/reports/${month}`);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-disposition']).toContain(
    encodeURIComponent(template.name),
  );
  expect((await file.body()).subarray(0, 2).toString()).toBe('PK'); // zip
});
