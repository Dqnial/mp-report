import JSZip from 'jszip';
import { expect, test } from '@playwright/test';
import { makeTemplate, openApp, today, unique } from '../fixtures';

test('шаблон → план дня → визит по плану → предпросмотр и готовый xlsx', async ({
  page,
}) => {
  await openApp(page);
  const month = today().slice(0, 7);

  // загрузка шаблона через экран «Отчёт» (поле выбора файла)
  const template = await makeTemplate();
  await page.getByRole('link', { name: 'Отчёт', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: /Загрузить шаблон|Заменить шаблон/ })
    .click();
  await (await chooser).setFiles(template);
  await expect(page.getByText(/Шаблон на .* загружен/)).toBeVisible();

  // план дня из шаблона и визит в запланированное ЛПУ через «+»
  await page.getByRole('link', { name: 'Визиты', exact: true }).click();
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

test('отчёт: повторный заход не качает файл заново, новый визит — качает один раз', async ({
  page,
}) => {
  const month = today().slice(0, 7);
  const isFile = (url: string) =>
    new RegExp(`/api/reports/${month}$`).test(new URL(url).pathname);
  let fileRequests = 0;
  page.on('request', (r) => {
    if (isFile(r.url())) fileRequests++;
  });
  const send = page.getByRole('button', { name: 'Отправить отчёт' });
  const placed = async () =>
    Number(
      (await page.getByText(/в файл попадёт визитов: \d+/).textContent())!.match(
        /визитов: (\d+)/,
      )![1],
    );

  // первый заход: проверка + файл
  await openApp(page);
  await page.getByRole('link', { name: 'Отчёт', exact: true }).click();
  await expect(send).toBeEnabled();
  expect(fileRequests).toBe(1);
  const before = await placed();

  // туда-обратно без изменений: только проверка, файл из памяти
  await page.getByRole('link', { name: 'Визиты', exact: true }).click();
  await page.getByRole('link', { name: 'Отчёт', exact: true }).click();
  await expect(send).toBeEnabled();
  expect(fileRequests).toBe(1);

  // фоновая синхронизация (раз в 2 минуты, при появлении сети): проверка
  // повторяется, а файл той же версии — нет
  const recheck = page.waitForResponse((r) =>
    r.url().endsWith(`/api/reports/${month}/check`),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await recheck;
  await expect(send).toBeEnabled();
  expect(fileRequests).toBe(1);

  // новый визит на сервере (как с другого устройства) — новая версия
  const name = unique('Версионный Иван');
  const id = `e2e-${Date.now().toString(36)}`;
  const put = await page.request.put(`/api/visits/sync/${id}`, {
    data: {
      clientId: id,
      date: today(),
      kind: 'DOCTOR',
      placeName: 'Клиника Бета',
      fullName: name,
      products: [],
      updatedAt: new Date().toISOString(),
    },
  });
  expect(put.ok()).toBe(true);

  await page.getByRole('link', { name: 'Визиты', exact: true }).click();
  await page.getByRole('link', { name: 'Отчёт', exact: true }).click();
  await expect(send).toBeEnabled();
  expect(fileRequests).toBe(2);
  expect(await placed()).toBe(before + 1);

  // в файле этой версии — новый визит (тело ответа страницы недоступно:
  // в собранной версии запрос идёт через сервис-воркер — берём файл напрямую)
  const xlsx = await (await page.request.get(`/api/reports/${month}`)).body();
  const sheet = await (await JSZip.loadAsync(xlsx))
    .file('xl/worksheets/sheet1.xml')!
    .async('string');
  expect(sheet).toContain(name);
});
