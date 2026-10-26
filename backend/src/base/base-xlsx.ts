// Файл «База врачей и аптек» от руководителя: справочник вписывается в его
// листы так же бережно, как визиты в отчёт, — меняются только строки данных
// двух листов, остальная книга (скрытые листы, внешние ссылки, стили)
// остаётся как была.
//
// Листы и колонки ищем по заголовкам, а не по буквам: врачи — лист, где в
// строке заголовка есть «ФИО» и «ЛПУ», аптеки — «ФИО» и «Аптека».
import {
  blankRow,
  listSheets,
  openXlsx,
  parseRows,
  readPart,
  readSharedStrings,
  type Row,
  setCellInRow,
  TemplateFormatError,
} from '../xlsx/xlsx-xml';

export type BaseField =
  | 'num'
  | 'mp'
  | 'city'
  | 'fullName'
  | 'specialty'
  | 'phone'
  | 'place'
  | 'address'
  | 'products'
  | 'potential';

/** Колонка по тексту заголовка (сравнение — в нижнем регистре). */
const HEADERS: [BaseField, RegExp][] = [
  ['num', /^№/],
  // \b в JS не видит границу кириллического слова
  ['mp', /^мп(\s|$)/],
  ['city', /^город/],
  ['fullName', /фио/],
  ['specialty', /специальн/],
  ['phone', /телефон/],
  ['place', /^(лпу|аптека)/],
  ['address', /^адрес/],
  ['products', /препарат/],
  ['potential', /п[ао]тенциал/],
];

/** Сколько первых строк листа смотрим в поисках заголовка. */
const HEADER_SEARCH_ROWS = 10;

export type BaseRecord = Partial<Record<BaseField, string>>;

interface BaseSheet {
  kind: 'doctors' | 'pharmacies';
  name: string;
  path: string;
  xml: string;
  rows: Row[];
  header: number;
  cols: Partial<Record<BaseField, string>>;
  /** город из заголовка («Город Алматы») или из строки-примера */
  city: string;
}

function findHeader(rows: Row[]) {
  for (const row of rows.slice(0, HEADER_SEARCH_ROWS)) {
    const cols: Partial<Record<BaseField, string>> = {};
    let placeText = '';
    for (const cell of row.cells.values()) {
      const text = cell.value.toLowerCase().replace(/\s+/g, ' ').trim();
      const field = HEADERS.find(([, re]) => re.test(text))?.[0];
      if (!field || cols[field]) continue;
      cols[field] = cell.col;
      if (field === 'place') placeText = text;
    }
    if (cols.fullName && cols.place) {
      const kind = placeText.startsWith('лпу') ? 'doctors' : 'pharmacies';
      return { header: row.r, cols, kind } as const;
    }
  }
  return null;
}

function cityOf(rows: Row[], header: number, col?: string) {
  if (!col) return '';
  const head = rows.find((r) => r.r === header)?.cells.get(col)?.value ?? '';
  const fromHeader = head.replace(/^\s*город\s*/i, '').trim();
  if (fromHeader) return fromHeader;
  return (
    rows.find((r) => r.r > header && r.cells.get(col)?.value)?.cells.get(col)
      ?.value ?? ''
  );
}

async function loadBase(file: Buffer) {
  const zip = await openXlsx(file);
  const sst = await readSharedStrings(zip);
  const sheets: BaseSheet[] = [];
  for (const { name, path } of await listSheets(zip)) {
    const xml = await readPart(zip, path);
    if (!xml) continue;
    const rows = parseRows(xml, sst);
    const found = findHeader(rows);
    // по одному листу каждого вида — первый подходящий
    if (!found || sheets.some((s) => s.kind === found.kind)) continue;
    const city = cityOf(rows, found.header, found.cols.city);
    sheets.push({ ...found, name, path, xml, rows, city });
  }
  if (!sheets.length) {
    throw new TemplateFormatError(
      'Не нашёл листы базы: нужен лист с колонками «ФИО» и «ЛПУ» (врачи) или «ФИО» и «Аптека» (аптеки)',
    );
  }
  return { zip, sheets };
}

export interface BaseInfo {
  doctors?: { sheet: string };
  pharmacies?: { sheet: string };
}

/** Проверка при загрузке: какие листы базы есть в файле. */
export async function analyzeBase(file: Buffer): Promise<BaseInfo> {
  const { sheets } = await loadBase(file);
  return Object.fromEntries(sheets.map((s) => [s.kind, { sheet: s.name }]));
}

// ─── запись листа ────────────────────────────────────────────────────────────

/**
 * Диапазоны листа, которые описывают таблицу (фильтр, условное
 * форматирование, проверка данных, размеры), растягиваем на добавленные
 * строки: иначе фильтр и подсветка повторов ФИО не увидят новых врачей.
 * Трогаем только диапазоны, начинающиеся не ниже первой строки данных и
 * кончающиеся внутри таблицы.
 */
function extendRanges(xml: string, firstData: number, lastRow: number) {
  const extend = (range: string) =>
    range.replace(
      /^(\$?[A-Z]{1,3}\$?)(\d+):(\$?[A-Z]{1,3}\$?)(\d+)$/,
      (all, c1: string, r1: string, c2: string, r2: string) =>
        Number(r1) <= firstData &&
        Number(r2) >= firstData &&
        Number(r2) < lastRow
          ? `${c1}${r1}:${c2}${lastRow}`
          : all,
    );
  return xml.replace(
    /(<(?:dimension|autoFilter|conditionalFormatting|dataValidation)\b[^>]*?\s(?:ref|sqref)=")([^"]*)"/g,
    (_, head: string, v: string) =>
      `${head}${v.split(' ').map(extend).join(' ')}"`,
  );
}

/**
 * Пишет записи подряд с первой строки под заголовком. Существующие строки
 * сохраняют своё оформление (у руководителя оно разное по строкам), новые —
 * копируют оформление строки выше. Ячейки вне колонок базы (например,
 * справочная табличка сбоку) не трогаем. Старые значения под записями
 * (строка-пример) стираем, нумерацию № продолжаем.
 */
function fillSheet(sheet: BaseSheet, records: BaseRecord[]) {
  const first = sheet.header + 1;
  const byNum = new Map(sheet.rows.map((r) => [r.r, r]));
  const fields = Object.entries(sheet.cols) as [BaseField, string][];
  const dataFields = fields.filter(([f]) => f !== 'num');

  const write = (row: Row, values: BaseRecord) => {
    let xml = row.xml;
    for (const [field, col] of fields) {
      const value = values[field];
      if (value === undefined) continue;
      if (value === (row.cells.get(col)?.value ?? '')) continue;
      xml = setCellInRow(xml, `${col}${row.r}`, value, row.cells.get(col));
    }
    return xml;
  };

  const out = new Map<number, string>(sheet.rows.map((r) => [r.r, r.xml]));
  records.forEach((rec, i) => {
    const r = first + i;
    const row =
      byNum.get(r) ?? blankRow(byNum.get(r - 1) ?? byNum.get(sheet.header)!, r);
    byNum.set(r, row);
    const values: BaseRecord = { num: String(i + 1) };
    for (const [field] of dataFields) values[field] = rec[field] ?? '';
    out.set(r, write(row, values));
  });

  // ниже записей — стираем то, что было в колонках базы (пример руководителя)
  const lastRow = first + records.length - 1;
  for (const row of sheet.rows) {
    if (row.r <= lastRow || row.r < first) continue;
    if (!dataFields.some(([, col]) => row.cells.get(col)?.value)) continue;
    const blank: BaseRecord = {};
    for (const [field] of dataFields) blank[field] = '';
    out.set(row.r, write(row, blank));
  }

  const rowsXml = [...out.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, xml]) => xml)
    .join('');
  const xml = sheet.xml.replace(
    /<sheetData\b[^>]*?(?:\/>|>[\s\S]*?<\/sheetData>)/,
    () => `<sheetData>${rowsXml}</sheetData>`,
  );
  return extendRanges(xml, first, Math.max(lastRow, first));
}

export interface BaseData {
  /** ФИО медпреда — колонка «МП» */
  mp: string;
  doctors: BaseRecord[];
  pharmacies: BaseRecord[];
}

export interface BaseFillResult {
  file: Buffer;
  doctors: number;
  pharmacies: number;
  warnings: string[];
}

export async function fillBase(
  file: Buffer,
  data: BaseData,
): Promise<BaseFillResult> {
  const { zip, sheets } = await loadBase(file);
  const warnings: string[] = [];
  const counts = { doctors: 0, pharmacies: 0 };

  for (const sheet of sheets) {
    const records = data[sheet.kind].map((r) => ({
      ...r,
      mp: data.mp,
      city: sheet.city,
      potential: '',
    }));
    zip.file(sheet.path, fillSheet(sheet, records), { createFolders: false });
    counts[sheet.kind] = records.length;
  }
  if (!sheets.some((s) => s.kind === 'doctors') && data.doctors.length) {
    warnings.push('В файле нет листа врачей — врачи в базу не попали');
  }
  if (!sheets.some((s) => s.kind === 'pharmacies') && data.pharmacies.length) {
    warnings.push('В файле нет листа аптек — аптеки в базу не попали');
  }

  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
  return { file: out, ...counts, warnings };
}
