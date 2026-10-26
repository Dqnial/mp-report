import { expect, type APIRequestContext, type Page } from '@playwright/test';
import JSZip from 'jszip';

/** Учётная запись для тестов — создаётся перед прогоном (npm run user:create). */
export const USER = {
  login: process.env.E2E_LOGIN ?? 'e2e',
  password: process.env.E2E_PASSWORD ?? 'e2e-password-1',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Сегодня в местном времени браузера — YYYY-MM-DD, как его ждёт приложение. */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Уникальная строка, чтобы тесты не мешали друг другу и прошлым прогонам. */
export const unique = (prefix: string) =>
  `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** Открыть приложение уже вошедшим (сессия из tests/auth.setup.ts). */
export async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible();
}

/** Вход через форму — для тестов самого входа. */
export async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Логин').fill(USER.login);
  await page.getByLabel('Пароль').fill(USER.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/$/);
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cell = (ref: string, text?: string) =>
  text
    ? `<c r="${ref}" s="1" t="inlineStr"><is><t>${esc(text)}</t></is></c>`
    : `<c r="${ref}" s="1"/>`;

/**
 * Вымышленный шаблон текущего месяца — устроен как настоящий: блок строк на
 * день, дата в D, № в B, «Врач»/«Аптека» в C, план (ЛПУ и адрес) в E/F.
 * Дни — все дни месяца (и выходные), чтобы тесты шли в любой день.
 * filled — строка, уже заполненная в Excel (первая строка плана этого дня).
 */
export async function makeTemplate(filled?: { day: number; fullName: string }) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const plan: [string, string, number][] = [
    ['Городская поликлиника №3', 'ул. Лесная 12', 4],
    ['Аптека Фармленд', 'ул. Садовая 46', 1],
  ];
  const spare = 4;
  let rows = `<row r="1">${cell('A1', 'шапка')}</row>`;
  const merges: string[] = [];
  let r = 2;
  for (let d = 1; d <= days; d++) {
    const first = r;
    const slots: { place?: string; address?: string }[] = [];
    for (const [place, address, n] of plan) {
      for (let k = 0; k < n; k++) slots.push(k ? {} : { place, address });
    }
    for (let k = 0; k < spare; k++) slots.push({});
    slots.forEach((s, i) => {
      rows +=
        `<row r="${r}">` +
        cell(`A${r}`) +
        cell(`B${r}`, String(i + 1)) +
        cell(`C${r}`, 'Врач') +
        cell(`D${r}`, i ? undefined : `${pad(d)}.${pad(m + 1)}.${y}`) +
        cell(`E${r}`, s.place) +
        cell(`F${r}`, s.address) +
        cell(
          `G${r}`,
          filled?.day === d && i === 0 ? filled.fullName : undefined,
        ) +
        ['H', 'I', 'J', 'K', 'L', 'M', 'N']
          .map((c) => cell(`${c}${r}`))
          .join('') +
        `</row>`;
      r++;
    });
    merges.push(`A${first}:A${r - 1}`);
  }
  const buffer = await xlsx([
    {
      name: 'План и факт',
      xml:
        `<sheetData>${rows}</sheetData>` +
        `<mergeCells count="${merges.length}">${merges.map((x) => `<mergeCell ref="${x}"/>`).join('')}</mergeCells>`,
    },
  ]);
  return {
    name: `План и факт E2E ${y}-${pad(m + 1)}.xlsx`,
    mimeType: XLSX_MIME,
    buffer,
  };
}

/**
 * Вымышленная «База врачей и аптек» как у руководителя: лист врачей (шапка во
 * 2-й строке, пара подготовленных строк с № и строкой-примером) и лист аптек.
 */
export async function makeBase() {
  const head = (r: number, titles: string[]) =>
    `<row r="${r}">${titles.map((t, i) => cell(`${COLS[i]}${r}`, t)).join('')}</row>`;
  const numbered = (
    r: number,
    n: number,
    width: number,
    example: string[] = [],
  ) =>
    `<row r="${r}">${cell(`A${r}`, String(n))}${[...COLS.slice(1, width)]
      .map((c, i) => cell(`${c}${r}`, example[i]))
      .join('')}</row>`;
  const doctors =
    head(2, [
      '№',
      'МП ',
      'Город Тестоград',
      'ФИО  Врача',
      'Специальность',
      'Сот телефон ',
      'ЛПУ',
      'адрес',
      'Препарата',
      'Патенциаль',
    ]) +
    numbered(3, 1, 10, [
      'Пример Представитель',
      'Тестоград',
      'Образцова Ольга Петровна',
      'ВОП',
      '',
      'ГП Пример',
      '',
      '',
      'Средний',
    ]) +
    numbered(4, 2, 10);
  const pharmacies =
    head(1, [
      '№',
      'ФИО  провизора',
      'Специальность',
      'Сот телефон ',
      'Аптека',
      'Адрес',
    ]) + numbered(2, 1, 6);
  return {
    name: 'База врачей и аптек E2E.xlsx',
    mimeType: XLSX_MIME,
    buffer: await xlsx([
      { name: 'База врачей', xml: `<sheetData>${doctors}</sheetData>` },
      { name: 'База аптек', xml: `<sheetData>${pharmacies}</sheetData>` },
    ]),
  };
}

/**
 * Загрузить шаблон через API и дождаться фонового импорта строк из файла
 * (с Redis он идёт в очереди, без — сразу в запросе).
 */
export async function uploadTemplate(
  request: APIRequestContext,
  file: Awaited<ReturnType<typeof makeTemplate>>,
) {
  const res = await request.post('/api/templates', { multipart: { file } });
  expect(res.ok()).toBe(true);
  const { import: started } = (await res.json()) as {
    import?: { status: string; jobId?: string };
  };
  if (started?.status !== 'queued') return;
  await expect
    .poll(
      async () =>
        (
          (await (
            await request.get(`/api/templates/import/${started.jobId}`)
          ).json()) as { status: string }
        ).status,
      { timeout: 30_000 },
    )
    .toBe('done');
}

const COLS = 'ABCDEFGHIJ';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Минимальный корректный xlsx из готовых листов (содержимое <worksheet>). */
async function xlsx(sheets: { name: string; xml: string }[]) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('') +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets
        .map(
          (s, i) =>
            `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join('') +
      '</sheets></workbook>',
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('') +
      '</Relationships>',
  );
  sheets.forEach((s, i) =>
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${s.xml}</worksheet>`,
    ),
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}
