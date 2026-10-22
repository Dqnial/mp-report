import { expect, test, type Page } from '@playwright/test';
import { openApp, unique } from '../fixtures';

async function addDoctorVisit(page: Page, fullName: string) {
  await page.getByRole('link', { name: 'Врач' }).click();
  await expect(page).toHaveURL(/\/visit\/new/);
  // поля с подсказками — combobox (подпись Mantine есть и у списка подсказок)
  await page.getByRole('combobox', { name: 'ФИО врача' }).fill(fullName);
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'ЛПУ' }).fill('Городская поликлиника №3');
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Адрес' }).fill('ул. Лесная 12');
  await page.getByText('Коф Йог', { exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page).not.toHaveURL(/\/visit\//);
}

test('визит записывается, уходит на сервер и виден после перезагрузки', async ({
  page,
}) => {
  await openApp(page);
  const name = unique('Тестова Анна');
  await addDoctorVisit(page, name);

  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText('Всё на сервере')).toBeVisible();

  // данные экрана — из памяти телефона; убеждаемся, что дошло и до сервера
  const res = await page.request.get('/api/visits/search?q=' + encodeURIComponent(name));
  expect((await res.json()).visits).toHaveLength(1);

  await page.reload();
  await expect(page.getByText(name)).toBeVisible();
});

test('без сети визит сохраняется на телефоне и уходит, когда сеть появилась', async ({
  page,
  context,
}) => {
  await openApp(page);
  await expect(page.getByText('Всё на сервере')).toBeVisible();

  await context.setOffline(true);
  const name = unique('Офлайнова Мария');
  await addDoctorVisit(page, name);
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText(/отправки · нет сети/)).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('Всё на сервере')).toBeVisible({
    timeout: 45_000,
  });
  const res = await page.request.get('/api/visits/search?q=' + encodeURIComponent(name));
  expect((await res.json()).visits).toHaveLength(1);
});

test('поиск находит визит по части ФИО', async ({ page }) => {
  await openApp(page);
  const name = unique('Поисковая Елена');
  await addDoctorVisit(page, name);

  await page.getByText('Поиск по визитам…').click();
  // по уникальной части имени — визиты прошлых прогонов не мешают
  await page
    .getByPlaceholder('ФИО, ЛПУ, аптека, телефон…')
    .fill(name.split(' ')[2]);
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText(/Найдено: 1 визит/)).toBeVisible();
});
