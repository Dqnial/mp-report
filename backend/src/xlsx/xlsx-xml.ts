// Примитивы правки xlsx «на месте»: книга открывается как zip, нужные листы
// разбираются регулярными выражениями и меняются построчно, остальные части
// пакета копируются как есть. Общие для отчёта и базы врачей/аптек.
import JSZip from 'jszip';

export class TemplateFormatError extends Error {}

// ─── XML-примитивы ───────────────────────────────────────────────────────────

export const escapeXml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const unescapeXml = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Убираем символы, недопустимые в XML 1.0 (вставки из мессенджеров и т.п.). */
const stripInvalidXmlChars = (s: string) =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');

export const colToNum = (col: string) =>
  [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

export const attr = (attrs: string, name: string) =>
  attrs.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** Текст из <si> или <is>: склеиваем все <t> (в т.ч. из rich-text <r>). */
export const textRuns = (xml: string) =>
  unescapeXml(
    [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((m) => m[1])
      .join(''),
  );

export interface Cell {
  col: string;
  attrs: string; // всё после r="..."
  xml: string; // исходная разметка ячейки
  value: string; // '' если пусто
}

export interface Row {
  r: number;
  xml: string;
  start: number; // позиция в XML листа
  cells: Map<string, Cell>;
}

const ROW_RE = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;
const CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

export function parseRows(xml: string, sst: string[]): Row[] {
  const rows: Row[] = [];
  for (const m of xml.matchAll(ROW_RE)) {
    const rowXml = m[0];
    const r = Number(attr(rowXml.slice(0, rowXml.indexOf('>')), 'r'));
    const cells = new Map<string, Cell>();
    for (const c of rowXml.matchAll(CELL_RE)) {
      const attrs = c[1];
      const ref = attr(attrs, 'r');
      if (!ref) continue;
      const col = ref.replace(/\d+/g, '');
      const inner = c[2] ?? '';
      const t = attr(attrs, 't');
      let value = '';
      if (t === 'inlineStr') value = textRuns(inner);
      else {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (v != null)
          value = t === 's' ? (sst[Number(v)] ?? '') : unescapeXml(v);
      }
      cells.set(col, { col, attrs, xml: c[0], value: value.trim() });
    }
    rows.push({ r, xml: rowXml, start: m.index, cells });
  }
  return rows;
}

export async function readPart(zip: JSZip, path: string) {
  const f = zip.file(path);
  return f ? f.async('string') : null;
}

/** Листы книги в порядке вкладок: [имя, путь к XML]. */
export async function listSheets(zip: JSZip) {
  const wb = await readPart(zip, 'xl/workbook.xml');
  const rels = await readPart(zip, 'xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new TemplateFormatError('Это не файл Excel (.xlsx)');

  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) targets.set(id, target);
  }
  return [...wb.matchAll(/<sheet\b[^>]*>/g)].flatMap((m) => {
    const name = unescapeXml(attr(m[0], 'name') ?? '');
    const target = targets.get(attr(m[0], 'r:id') ?? '');
    if (!target) return [];
    const path = target.startsWith('/')
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, '')}`;
    return [{ name, path }];
  });
}

/** Пустая строка с оформлением образца: те же атрибуты строки и стили ячеек. */
export function blankRow(source: Row, to: number): Row {
  const open = source.xml
    .match(/^<row\b[^>]*?(?=\/?>)/)![0]
    .replace(/\sr="\d+"/, ` r="${to}"`);
  const cells = [...source.cells.values()]
    .map((c) => {
      const s = attr(c.attrs, 's');
      return `<c r="${c.col}${to}"${s ? ` s="${s}"` : ''}/>`;
    })
    .join('');
  return parseRows(cells ? `${open}>${cells}</row>` : `${open}/>`, [])[0];
}

export const renumberRow = (xml: string, to: number) =>
  xml
    .replace(/^(<row\b[^>]*?\sr=")\d+"/, (_, p: string) => `${p}${to}"`)
    .replace(/(<c\b[^>]*?\sr="[A-Z]+)\d+"/g, (_, p: string) => `${p}${to}"`);

/**
 * Заменить ячейку строки (или вставить по порядку колонок, если её нет).
 * build получает атрибуты ячейки без типа t: у существующей — её (стиль s
 * сохраняется), у новой — r и стиль style, если задан.
 */
// замены — функциями: в строке-замене `$&`, `$1` из текста визита сработали бы как шаблоны
function putCell(
  rowXml: string,
  ref: string,
  existing: Cell | undefined,
  build: (attrs: string) => string,
  style?: string,
) {
  if (existing) {
    const attrs = existing.attrs.replace(/\s+t="[^"]*"/, '');
    return rowXml.replace(existing.xml, () => build(attrs));
  }
  const col = ref.replace(/\d+/g, '');
  const cell = build(` r="${ref}"${style ? ` s="${style}"` : ''}`);
  if (rowXml.endsWith('/>')) return `${rowXml.slice(0, -2)}>${cell}</row>`;
  const next = [...rowXml.matchAll(/<c\b[^>]*?\sr="([A-Z]+)\d+"/g)].find(
    (c) => colToNum(c[1]) > colToNum(col),
  );
  return next
    ? rowXml.replace(next[0], () => cell + next[0])
    : rowXml.replace(/<\/row>$/, () => `${cell}</row>`);
}

/** Вписывает значение в ячейку строки, сохраняя её стиль (атрибут s). */
export function setCellInRow(
  rowXml: string,
  ref: string,
  value: string,
  existing?: Cell,
  style?: string,
) {
  if (value === '') {
    if (!existing) return rowXml;
    return putCell(rowXml, ref, existing, (attrs) => `<c${attrs}/>`);
  }
  const text = escapeXml(stripInvalidXmlChars(value));
  return putCell(
    rowXml,
    ref,
    existing,
    (attrs) =>
      `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`,
    style,
  );
}

/**
 * Формула с уже посчитанным значением: Excel пересчитает при правке, а до
 * того (и в просмотрщиках, которые не считают формулы) видно value.
 */
export function setFormulaInRow(
  rowXml: string,
  ref: string,
  formula: string,
  value: number,
  existing?: Cell,
  style?: string,
) {
  return putCell(
    rowXml,
    ref,
    existing,
    (attrs) => `<c${attrs}><f>${escapeXml(formula)}</f><v>${value}</v></c>`,
    style,
  );
}

/** Таблица общих строк книги (значения ячеек t="s"). */
export async function readSharedStrings(zip: JSZip) {
  const xml = await readPart(zip, 'xl/sharedStrings.xml');
  return xml
    ? [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1]))
    : [];
}

/** Открыть xlsx; не zip — понятная ошибка формата. */
export async function openXlsx(file: Buffer) {
  try {
    return await JSZip.loadAsync(file);
  } catch {
    throw new TemplateFormatError('Это не файл Excel (.xlsx)');
  }
}

/**
 * Убрать цепочку вычислений (xl/calcChain.xml) — список ячеек с формулами.
 * После правки формул она устаревает, и Excel считает книгу повреждённой
 * («Ошибка в части содержимого»); без неё он строит её заново при открытии.
 */
export async function dropCalcChain(zip: JSZip) {
  if (!zip.file('xl/calcChain.xml')) return;
  zip.remove('xl/calcChain.xml');
  const types = await readPart(zip, '[Content_Types].xml');
  if (types) {
    zip.file(
      '[Content_Types].xml',
      types.replace(
        /<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/,
        '',
      ),
      { createFolders: false },
    );
  }
  const rels = await readPart(zip, 'xl/_rels/workbook.xml.rels');
  if (rels) {
    zip.file(
      'xl/_rels/workbook.xml.rels',
      rels.replace(
        /<Relationship\b[^>]*Target="[^"]*calcChain\.xml"[^>]*\/>/,
        '',
      ),
      { createFolders: false },
    );
  }
}
