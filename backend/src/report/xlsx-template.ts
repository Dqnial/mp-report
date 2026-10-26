// Работа с Excel-шаблоном руководителя без пересборки книги.
//
// Компания требует не менять файл — только вписывать значения в пустые ячейки.
// Библиотеки вроде exceljs пересобирают пакет (теряют externalLinks, ломают
// definedNames), поэтому открываем xlsx как zip, правим лишь XML листа визитов,
// а все остальные части копируем как есть (примитивы — xlsx/xlsx-xml.ts).
import JSZip from 'jszip';
import { shortRu as fmt } from '../common/dates';
import { placeMatch } from '../common/place-match';
import {
  attr,
  blankRow,
  escapeXml,
  listSheets,
  openXlsx,
  parseRows,
  readPart,
  readSharedStrings,
  renumberRow,
  type Row,
  setCellInRow,
  TemplateFormatError,
} from '../xlsx/xlsx-xml';

export { TemplateFormatError };

// ─── устройство листа ────────────────────────────────────────────────────────
// A — день недели (объединена на блок), B — № слота, C — «Врач»/«Аптека»,
// D — дата в первой строке блока, E..N — поля визита.

export const VISIT_COLS = {
  kind: 'C',
  placeName: 'E',
  address: 'F',
  fullName: 'G',
  specialty: 'H',
  phone: 'I',
  products: ['J', 'K', 'L', 'M'],
  comment: 'N',
} as const;

/** Метка в C — как в шаблоне руководителя (чаще всего так и написано). */
const KIND_LABEL = { DOCTOR: 'Врач', PHARMACY: 'Аптека' } as const;

/** Слот занят, если в любой из этих колонок что-то есть. E/F — это план. */
const VISIT_DATA_COLS = ['G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];

export interface VisitCells {
  /** clientId визита — для предпросмотра (строка → визит) */
  id?: string;
  date: string; // YYYY-MM-DD
  kind?: 'DOCTOR' | 'PHARMACY';
  placeName?: string | null;
  address?: string | null;
  fullName?: string | null;
  specialty?: string | null;
  phone?: string | null;
  products: string[]; // готовый текст для J–M, до 4
  comment?: string | null;
}

/**
 * Строка дня. ЛПУ (E) пишется только в первой строке группы — «заголовке»;
 * пустое E ниже означает «там же»: план «обойти N врачей в этом ЛПУ».
 * Аптеки обычно — каждая своей строкой-заголовком.
 */
export interface Slot {
  row: number;
  numbered: boolean;
  free: boolean;
  /** своё E этой строки (непусто — строка-заголовок группы) */
  plannedPlace: string;
  plannedAddress: string;
  /** ЛПУ/адрес группы, к которой относится строка (от заголовка выше) */
  groupPlace: string;
  groupAddress: string;
  /** колонка C: «Врач» / «Аптека» — её не соблюдают, только для подсказок */
  label: string;
  /** строки нет в шаблоне — добавим её в конце дня (визитов больше, чем строк) */
  extra?: boolean;
  /**
   * последняя строка дня, уже заполненная «там же», оказалась ниже добавленных
   * строк: считаем её заголовком своей группы, чтобы она не «переехала» под ЛПУ,
   * открытое в добавленных строках (тогда впишем ей ЛПУ — ячейка E пустая)
   */
  boundary?: boolean;
}

export interface DayBlock {
  date: string; // YYYY-MM-DD
  firstRow: number;
  lastRow: number;
  slots: Slot[];
}

export interface TemplateInfo {
  sheetName: string;
  month: string; // YYYY-MM
  days: DayBlock[];
}

// ─── даты в колонке D ────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/** «01.10.2026», «1.10.26» или серийное число Excel (система 1900) → YYYY-MM-DD. */
export function parseSheetDate(raw: string): string | null {
  const s = raw.trim();
  const ru = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/);
  if (ru) {
    const [d, m] = [Number(ru[1]), Number(ru[2])];
    const y = ru[3].length === 2 ? 2000 + Number(ru[3]) : Number(ru[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const ms = Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

// ─── пакет ───────────────────────────────────────────────────────────────────

interface LoadedSheet {
  zip: JSZip;
  path: string;
  name: string;
  xml: string;
  rows: Row[];
}

/** Лист визитов — первый, где в колонке D есть хотя бы одна дата. */
async function loadVisitSheet(file: Buffer): Promise<LoadedSheet> {
  const zip = await openXlsx(file);
  const sst = await readSharedStrings(zip);

  for (const sheet of await listSheets(zip)) {
    const xml = await readPart(zip, sheet.path);
    if (!xml) continue;
    const rows = parseRows(xml, sst);
    if (rows.some((r) => parseSheetDate(r.cells.get('D')?.value ?? ''))) {
      return { zip, path: sheet.path, name: sheet.name, xml, rows };
    }
  }
  throw new TemplateFormatError(
    'Не нашёл лист с визитами: ни в одном листе нет дат в колонке D',
  );
}

/** Объединения в колонке A: первая строка → последняя (A5:A26 → 5 → 26). */
function columnAMerges(xml: string) {
  const merges = new Map<number, number>();
  for (const m of xml.matchAll(/<mergeCell ref="A(\d+):A(\d+)"/g)) {
    merges.set(Number(m[1]), Number(m[2]));
  }
  return merges;
}

const isSlotNumber = (r: Row) => /^\d+$/.test(r.cells.get('B')?.value ?? '');

/**
 * Блоки дней: от строки с датой в D до строки перед следующей датой.
 * Последний день ограничиваем объединением ячейки дня недели в A (за ним
 * бывают заготовки без даты); если объединения нет — последним слотом.
 */
function findDays(rows: Row[], xml: string): DayBlock[] {
  const merges = columnAMerges(xml);
  const dateIdx = rows.flatMap((row, i) => {
    const date = parseSheetDate(row.cells.get('D')?.value ?? '');
    return date ? [{ i, date }] : [];
  });

  return dateIdx.map(({ i, date }, k) => {
    const isLast = k + 1 === dateIdx.length;
    let block = rows.slice(i, isLast ? rows.length : dateIdx[k + 1].i);
    if (isLast) {
      const mergeEnd = merges.get(rows[i].r);
      block = mergeEnd
        ? block.filter((r) => r.r <= mergeEnd)
        : block.slice(0, block.findLastIndex(isSlotNumber) + 1);
    }

    let groupPlace = '';
    let groupAddress = '';
    const slots: Slot[] = block.map((r) => {
      const plannedPlace = r.cells.get('E')?.value ?? '';
      const plannedAddress = r.cells.get('F')?.value ?? '';
      if (plannedPlace) {
        groupPlace = plannedPlace;
        groupAddress = plannedAddress;
      }
      return {
        row: r.r,
        numbered: isSlotNumber(r),
        free: VISIT_DATA_COLS.every((c) => !r.cells.get(c)?.value),
        plannedPlace,
        plannedAddress,
        groupPlace,
        groupAddress: plannedAddress || groupAddress,
        label: r.cells.get('C')?.value ?? '',
      };
    });
    return {
      date,
      firstRow: block[0].r,
      lastRow: block[block.length - 1].r,
      slots,
    };
  });
}

function mostCommonMonth(days: DayBlock[]) {
  const counts = new Map<string, number>();
  for (const d of days) {
    const m = d.date.slice(0, 7);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

export async function analyzeTemplate(file: Buffer): Promise<TemplateInfo> {
  const sheet = await loadVisitSheet(file);
  const days = findDays(sheet.rows, sheet.xml);
  return { sheetName: sheet.name, month: mostCommonMonth(days), days };
}

/** Уже заполненная строка визита — для импорта. Значения как в ячейках. */
export interface FilledRow {
  date: string; // YYYY-MM-DD
  row: number;
  /** C, E..N → текст ячейки ('' если пусто) */
  cells: Record<string, string>;
  /** ЛПУ/адрес группы — для строк с пустым E («там же, что выше») */
  groupPlace: string;
  groupAddress: string;
}

const FILLED_COLS = ['C', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];

export async function readFilledRows(
  file: Buffer,
): Promise<TemplateInfo & { filled: FilledRow[] }> {
  const sheet = await loadVisitSheet(file);
  const days = findDays(sheet.rows, sheet.xml);
  const byNum = new Map(sheet.rows.map((r) => [r.r, r]));
  const filled = days.flatMap((d) =>
    d.slots
      .filter((s) => !s.free)
      .map((s) => {
        const row = byNum.get(s.row)!;
        const cells = Object.fromEntries(
          FILLED_COLS.map((c) => [c, row.cells.get(c)?.value ?? '']),
        );
        return {
          date: d.date,
          row: s.row,
          cells,
          groupPlace: s.groupPlace,
          groupAddress: s.groupAddress,
        };
      }),
  );
  return {
    sheetName: sheet.name,
    month: mostCommonMonth(days),
    days,
    filled,
  };
}

// ─── заполнение ──────────────────────────────────────────────────────────────

export { normPlace } from '../common/place-match';

export interface Placement {
  row: number;
  /** визит не по плану открыл новую группу — в строку вписываем ЛПУ и адрес */
  newHead: boolean;
  /**
   * группу открыл в строке плана, куда за день так и не сходили: ЛПУ и адрес
   * плана заменяем фактическими (так делают и вручную в Excel)
   */
  replacesPlan?: boolean;
}

/** Группа дня «ЛПУ + строки под ним» — для блока «По плану». */
export interface PlanGroup {
  row: number;
  place: string;
  address: string;
  label: string;
  /** строк в группе */
  capacity: number;
  /** занято: записано в файле + визиты из приложения */
  used: number;
  /** группа есть в файле (план или уже записанное), а не открыта визитом */
  inFile: boolean;
}

export interface DayPlacement {
  /** по индексу визита; null — не хватило строк */
  placements: (Placement | null)[];
  groups: PlanGroup[];
}

/**
 * Раскладка визитов дня по строкам — по тому, как устроен план:
 * 1) визит в ЛПУ из плана — в первую свободную строку группы этого ЛПУ;
 * 2) ЛПУ нет в плане или его группа заполнена — визит открывает новую
 *    группу в свободном хвосте последней группы дня (запасные строки в
 *    конце дня): туда пишем ЛПУ и адрес, следующие визиты в это же место
 *    лягут под неё;
 * 3) запасных строк нет — только в отчёте (reusePlan): занимаем группу плана,
 *    где ни одной строки не заполнено (туда за день не сходили), — ЛПУ и
 *    адрес плана заменяются фактическими; на экране «По плану» так не делаем,
 *    иначе запланированное место пропало бы из списка, пока медпред в пути.
 * Одно место — это название И адрес: «Фармленд» на Лесная и на Садовая — разные
 * аптеки (пустой адрес подходит к любому).
 * Сначала раскладываем визиты по плану, потом остальные — в порядке ввода.
 */
export function placeDay(
  day: DayBlock,
  visits: { placeName?: string | null; address?: string | null }[],
  { reusePlan = false }: { reusePlan?: boolean } = {},
): DayPlacement {
  const rows = day.slots.map((s) => ({
    ...s,
    head: !!s.plannedPlace || !!s.boundary,
    inFile: !!s.plannedPlace,
    newHead: false,
    replacesPlan: false,
    /** адрес группы, которую открывает эта строка */
    headAddress: s.plannedPlace ? s.plannedAddress : s.groupAddress,
  }));
  /** [начало, конец) группы, в которую входит строка i; начало -1 — до первого ЛПУ */
  const groupOf = (i: number): [number, number] => {
    let start = i;
    while (start >= 0 && !rows[start].head) start--;
    let end = i + 1;
    while (end < rows.length && !rows[end].head) end++;
    return [start, end];
  };
  const heads = () => rows.flatMap((r, i) => (r.head ? [i] : []));

  /** Свободная строка в группе этого места; сначала — где адрес совпал точно. */
  const freeInGroupOf = (place: string, address?: string | null) => {
    const candidates = heads()
      .map((h) => ({
        h,
        score: placeMatch(
          { name: place, address },
          { name: rows[h].groupPlace, address: rows[h].headAddress },
        ),
      }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const { h } of candidates) {
      const [, end] = groupOf(h);
      for (let i = h; i < end; i++) if (rows[i].free) return i;
    }
    return -1;
  };

  /**
   * Где открыть группу для ЛПУ не по плану: начало свободного хвоста
   * ПОСЛЕДНЕЙ группы дня, у которой он есть (обычно — запасные строки в конце
   * дня). Так запланированные ЛПУ не теряют строки, пока медпред ещё в пути.
   */
  const splitPoint = () => {
    const valid = (i: number) => {
      if (!rows[i].free || rows[i].head) return false;
      const [, end] = groupOf(i);
      return rows.slice(i, end).every((x) => x.free);
    };
    let last = -1;
    for (let i = rows.length - 1; i >= 0 && last < 0; i--) {
      if (valid(i)) last = i;
    }
    if (last < 0) return -1;
    let start = last;
    const [groupStart] = groupOf(last);
    while (start - 1 > groupStart && valid(start - 1)) start--;
    return start;
  };

  /** Группа плана, где не заполнено ни строки (последняя такая в дне). */
  const unusedPlanHead = () => {
    for (const h of heads().reverse()) {
      if (!rows[h].inFile || rows[h].newHead || rows[h].boundary) continue;
      const [, end] = groupOf(h);
      if (rows.slice(h, end).every((x) => x.free)) return h;
    }
    return -1;
  };

  const placements: (Placement | null)[] = visits.map(() => null);
  const take = (
    vi: number,
    i: number,
    open?: { place: string; address: string },
  ) => {
    rows[i].free = false;
    const replacesPlan = !!open && rows[i].inFile;
    if (open) {
      rows[i].head = true;
      rows[i].newHead = true;
      rows[i].replacesPlan = replacesPlan;
      rows[i].groupPlace = open.place;
      rows[i].headAddress = open.address;
    }
    placements[vi] = {
      row: rows[i].row,
      newHead: !!open,
      ...(replacesPlan && { replacesPlan }),
    };
  };

  // 1) по плану
  visits.forEach((v, vi) => {
    if (!v.placeName) return;
    const i = freeInGroupOf(v.placeName, v.address);
    if (i >= 0) take(vi, i);
  });
  // 2) остальные — с учётом групп, открытых предыдущими визитами
  visits.forEach((v, vi) => {
    if (placements[vi]) return;
    const i = v.placeName ? freeInGroupOf(v.placeName, v.address) : -1;
    if (i >= 0) return take(vi, i);
    // без ЛПУ строку «заголовком» не делаем — нечего вписать в E
    const open = v.placeName
      ? { place: v.placeName, address: v.address ?? '' }
      : undefined;
    const split = splitPoint();
    if (split >= 0) return take(vi, split, open);
    if (!reusePlan || !open) return;
    const h = unusedPlanHead();
    if (h >= 0) take(vi, h, open);
  });

  const groups = heads()
    .filter((h) => !rows[h].boundary)
    .map((h) => {
      const [, end] = groupOf(h);
      const members = rows.slice(h, end);
      return {
        row: rows[h].row,
        place: rows[h].groupPlace,
        address: rows[h].headAddress,
        label: rows[h].label,
        capacity: members.length,
        used: members.filter((r) => !r.free).length,
        inFile: rows[h].inFile,
      };
    });
  return { placements, groups };
}

/**
 * День с k добавленными строками — перед последней строкой дня, как при
 * «Вставить строку» в Excel: у последней строки жирная нижняя граница дня,
 * она остаётся внизу. Номера строк — после вставки (последняя сдвигается на k).
 */
export function expandDay(day: DayBlock, k: number): DayBlock {
  if (k <= 0 || day.slots.length < 2) return day;
  const before = day.slots.slice(0, -1);
  const last = day.slots[day.slots.length - 1];
  const prev = before[before.length - 1];
  const extras: Slot[] = Array.from({ length: k }, (_, i) => ({
    row: last.row + i,
    numbered: false,
    free: true,
    plannedPlace: '',
    plannedAddress: '',
    groupPlace: prev.groupPlace,
    groupAddress: prev.groupAddress,
    label: '',
    extra: true,
  }));
  const moved: Slot = {
    ...last,
    row: last.row + k,
    boundary: !last.plannedPlace && !last.free,
  };
  return {
    ...day,
    lastRow: last.row + k,
    slots: [...before, ...extras, moved],
  };
}

/** Больше строк в один день не добавляем — защита от зацикливания. */
const MAX_EXTRA_ROWS = 100;

/** Раскладка дня; не хватило строк — добавляем столько, сколько не влезло. */
function placeWithExtraRows(
  day: DayBlock,
  visits: VisitCells[],
  canInsert: boolean,
) {
  let block = day;
  let { placements } = placeDay(block, visits, { reusePlan: true });
  let extra = 0;
  for (;;) {
    const missing = placements.filter((p) => !p).length;
    if (!missing || !canInsert || day.slots.length < 2) break;
    if (extra >= MAX_EXTRA_ROWS) break;
    extra = Math.min(extra + missing, MAX_EXTRA_ROWS);
    block = expandDay(day, extra);
    ({ placements } = placeDay(block, visits, { reusePlan: true }));
  }
  return { block, extra, placements };
}

// ─── вставка строк ───────────────────────────────────────────────────────────
// Вставить строку = сдвинуть номера всех строк ниже и все ссылки на них:
// объединения (день недели в A растягивается на новые строки), автофильтр,
// размеры листа, выделение, именованные диапазоны. Формулы, рисунки, таблицы
// так не сдвинуть — с ними строки не добавляем (визиты останутся в предупреждении).

interface Insertion {
  /** исходный номер строки, перед которой вставляем */
  at: number;
  count: number;
  /** строка-образец оформления */
  source: Row;
}

const shiftRow = (r: number, ins: Insertion[]) =>
  r + ins.reduce((n, i) => (i.at <= r ? n + i.count : n), 0);

/** A5, $A$5, A5:B9, $2:$4 — сдвигаем номера строк. */
const shiftRef = (ref: string, ins: Insertion[]) =>
  ref
    .split(':')
    .map((part) =>
      part.replace(
        /^(\$?[A-Z]{0,3}\$?)(\d+)$/,
        (_, c: string, r: string) => c + String(shiftRow(Number(r), ins)),
      ),
    )
    .join(':');

/** Ссылки в атрибутах вне строк листа: объединения, фильтр, выделение… */
const shiftSheetRefs = (xml: string, ins: Insertion[]) =>
  ins.length
    ? xml
        .replace(
          /\b(ref|sqref|topLeftCell|activeCell)="([^"]*)"/g,
          (_, name: string, v: string) =>
            `${name}="${v
              .split(' ')
              .map((r) => shiftRef(r, ins))
              .join(' ')}"`,
        )
        .replace(/<rowBreaks\b[\s\S]*?<\/rowBreaks>/, (b) =>
          b.replace(
            /(<brk\b[^>]*?\sid=")(\d+)"/g,
            (_, p: string, r: string) => `${p}${shiftRow(Number(r), ins)}"`,
          ),
        )
    : xml;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Именованные диапазоны книги, указывающие на лист визитов. */
function shiftDefinedNames(wb: string, sheetName: string, ins: Insertion[]) {
  const name = escapeRe(escapeXml(sheetName));
  const re = new RegExp(
    `((?:&apos;|')?${name}(?:&apos;|')?!)(\\$?[A-Z]{0,3}\\$?\\d+(?::\\$?[A-Z]{0,3}\\$?\\d+)?)`,
    'g',
  );
  return wb.replace(
    /(<definedName\b[^>]*>)([^<]*)(<\/definedName>)/g,
    (_, open: string, text: string, close: string) =>
      open +
      text.replace(
        re,
        (__, pre: string, ref: string) => pre + shiftRef(ref, ins),
      ) +
      close,
  );
}

/** Можно ли безопасно вставлять строки в этот лист. */
async function canInsertRows(sheet: LoadedSheet) {
  const unsafe =
    /<f[\s>]|<formula[\s>]|<drawing\b|<legacyDrawing\b|<tableParts\b|<oleObjects\b|<controls\b/;
  if (unsafe.test(sheet.xml)) return false;
  // на лист ссылаются другие части книги (формулы других листов, диаграммы…)
  const needle = escapeXml(sheet.name);
  for (const [path, f] of Object.entries(sheet.zip.files)) {
    if (f.dir || path === sheet.path || path === 'xl/workbook.xml') continue;
    if (!/\.(xml|rels)$/.test(path)) continue;
    if ((await f.async('string')).includes(needle)) return false;
  }
  return true;
}

/** Строка, на которую похожи добавленные: самая частая разметка середины дня. */
function styleSource(day: DayBlock, rowsByNum: Map<number, Row>): Row {
  const middle = day.slots
    .slice(1, -1)
    .map((s) => rowsByNum.get(s.row))
    .filter((r): r is Row => !!r);
  if (!middle.length) return rowsByNum.get(day.slots[0].row)!;
  const sig = (r: Row) =>
    [...r.cells.values()]
      .map((c) => `${c.col}:${attr(c.attrs, 's') ?? ''}`)
      .join(',');
  const counts = new Map<string, number>();
  for (const r of middle) counts.set(sig(r), (counts.get(sig(r)) ?? 0) + 1);
  const best = Math.max(...counts.values());
  return middle.findLast((r) => counts.get(sig(r)) === best)!;
}

export interface FillResult {
  file: Buffer;
  placed: number;
  warnings: string[];
}

/** Что и куда впишем: общая часть отчёта и предпросмотра. */
interface FillPlan {
  sheet: LoadedSheet;
  days: Map<string, DayBlock>;
  insertions: Insertion[];
  /** итоговый номер строки → колонка → значение */
  finalEdits: Map<number, Map<string, string>>;
  /** итоговый номер строки → id визита */
  rowVisit: Map<number, string>;
  warnings: string[];
  placed: number;
}

async function planFill(file: Buffer, visits: VisitCells[]): Promise<FillPlan> {
  const sheet = await loadVisitSheet(file);
  const days = new Map(findDays(sheet.rows, sheet.xml).map((d) => [d.date, d]));
  const rowsByNum = new Map(sheet.rows.map((r) => [r.r, r]));
  const canInsert = await canInsertRows(sheet);

  const warnings: string[] = [];
  const overflow = new Map<string, number>();
  const insertions: Insertion[] = [];
  // правки по дням — в номерах строк «после вставки в этот день»
  const dayEdits: {
    day: DayBlock;
    edits: Map<number, Map<string, string>>;
    ids: Map<number, string>;
  }[] = [];
  let placed = 0;

  const byDay = new Map<string, VisitCells[]>();
  for (const v of visits) {
    byDay.set(v.date, [...(byDay.get(v.date) ?? []), v]);
  }

  for (const [date, dayVisits] of byDay) {
    const day = days.get(date);
    if (!day) {
      overflow.set(date, dayVisits.length);
      continue;
    }
    const { block, extra, placements } = placeWithExtraRows(
      day,
      dayVisits,
      canInsert,
    );
    const slotByRow = new Map(block.slots.map((s) => [s.row, s]));
    const edits = new Map<number, Map<string, string>>();
    const ids = new Map<number, string>();
    let headInExtra = false;

    dayVisits.forEach((v, vi) => {
      const p = placements[vi];
      if (!p) {
        overflow.set(date, (overflow.get(date) ?? 0) + 1);
        return;
      }
      placed++;
      const slot = slotByRow.get(p.row)!;
      if (slot.extra && p.newHead) headInExtra = true;
      const put = new Map<string, string>();
      const set = (col: string, val?: string | null) => {
        if (val?.trim()) put.set(col, val.trim());
      };
      // ЛПУ/адрес — только в строку, которой визит открыл новую группу;
      // в строках под заголовком они пустые, как пишут в отчёте («там же»).
      // Заголовок плана без адреса — адрес допишем (ячейка пустая).
      if (p.newHead) {
        set(VISIT_COLS.placeName, v.placeName);
        set(VISIT_COLS.address, v.address);
        // в строке плана адрес плана — от другого места: нет своего — стираем
        if (p.replacesPlan && !v.address?.trim())
          put.set(VISIT_COLS.address, '');
      } else if (slot.plannedPlace && !slot.plannedAddress) {
        set(VISIT_COLS.address, v.address);
      }
      // «Врач»/«Аптека» — в пустую C (в добавленных строках её нет совсем),
      // а в занятой строке плана — по факту
      if ((!slot.label || p.replacesPlan) && v.kind) {
        set(VISIT_COLS.kind, KIND_LABEL[v.kind]);
      }
      set(VISIT_COLS.fullName, v.fullName);
      set(VISIT_COLS.specialty, v.specialty);
      set(VISIT_COLS.phone, v.phone);
      v.products
        .slice(0, 4)
        .forEach((pr, i) => set(VISIT_COLS.products[i], pr));
      set(VISIT_COLS.comment, v.comment);
      edits.set(p.row, put);
      if (v.id) ids.set(p.row, v.id);
    });

    if (extra) {
      insertions.push({
        at: day.lastRow,
        count: extra,
        source: styleSource(day, rowsByNum),
      });
      // записанная «там же» последняя строка теперь под чужим ЛПУ — подписываем
      const last = block.slots[block.slots.length - 1];
      if (last.boundary && headInExtra && last.groupPlace) {
        const put = edits.get(last.row) ?? new Map<string, string>();
        put.set(VISIT_COLS.placeName, last.groupPlace);
        if (last.groupAddress && !last.plannedAddress) {
          put.set(VISIT_COLS.address, last.groupAddress);
        }
        edits.set(last.row, put);
      }
      warnings.push(
        `${fmt(date)}: визитов больше, чем строк в шаблоне — добавил строк в конце дня: ${extra}`,
      );
    }
    dayEdits.push({ day, edits, ids });
  }

  for (const [date, n] of overflow) {
    warnings.push(
      days.has(date)
        ? `${fmt(date)}: не хватило строк для ${n} визит(ов) — допишите вручную`
        : `${fmt(date)}: этого дня нет в шаблоне, ${n} визит(ов) не попали в отчёт`,
    );
  }

  // правки → в итоговые номера строк (с учётом вставок в более ранние дни)
  insertions.sort((a, b) => a.at - b.at);
  const finalEdits = new Map<number, Map<string, string>>();
  const rowVisit = new Map<number, string>();
  for (const { day, edits, ids } of dayEdits) {
    const before = insertions
      .filter((i) => i.at < day.lastRow)
      .reduce((n, i) => n + i.count, 0);
    for (const [r, put] of edits) {
      if (put.size) finalEdits.set(r + before, put);
    }
    for (const [r, id] of ids) rowVisit.set(r + before, id);
  }
  return { sheet, days, insertions, finalEdits, rowVisit, warnings, placed };
}

export async function fillTemplate(
  file: Buffer,
  visits: VisitCells[],
): Promise<FillResult> {
  const { sheet, insertions, finalEdits, warnings, placed } = await planFill(
    file,
    visits,
  );

  // каждая колонка правится один раз, так что исходная разметка остальных
  // ячеек строки остаётся на месте
  const applyEdits = (row: Row, put?: Map<string, string>) => {
    let rowXml = row.xml;
    for (const [col, val] of put ?? []) {
      rowXml = setCellInRow(rowXml, `${col}${row.r}`, val, row.cells.get(col));
    }
    return rowXml;
  };

  // собираем XML листа: меняются только тронутые и сдвинутые строки
  let xml = '';
  let pos = 0;
  for (const row of sheet.rows) {
    const to = shiftRow(row.r, insertions);
    const insertHere = insertions.find((i) => i.at === row.r);
    const put = finalEdits.get(to);
    if (!insertHere && to === row.r && !put?.size) continue;

    let out = '';
    if (insertHere) {
      for (let k = 0; k < insertHere.count; k++) {
        const n = to - insertHere.count + k;
        out += applyEdits(blankRow(insertHere.source, n), finalEdits.get(n));
      }
    }
    const filled = applyEdits(row, put);
    out += to === row.r ? filled : renumberRow(filled, to);
    xml += shiftSheetRefs(sheet.xml.slice(pos, row.start), insertions) + out;
    pos = row.start + row.xml.length;
  }
  xml += shiftSheetRefs(sheet.xml.slice(pos), insertions);

  // без createFolders: иначе JSZip добавит в архив записи папок «xl/», «xl/worksheets/»
  sheet.zip.file(sheet.path, xml, { createFolders: false });
  if (insertions.length) {
    const wb = (await readPart(sheet.zip, 'xl/workbook.xml'))!;
    const shifted = shiftDefinedNames(wb, sheet.name, insertions);
    if (shifted !== wb)
      sheet.zip.file('xl/workbook.xml', shifted, { createFolders: false });
  }
  const out = await sheet.zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
  return { file: out, placed, warnings };
}

// ─── предпросмотр ────────────────────────────────────────────────────────────

const PREVIEW_COLS = [
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
] as const;
type PreviewCol = (typeof PREVIEW_COLS)[number];

export interface PreviewRow {
  /** номер строки в готовом файле */
  row: number;
  /** № слота (B) и метка «Врач»/«Аптека» (C) */
  num: string;
  label: string;
  cells: Record<PreviewCol, string>;
  /** file — записано в шаблоне; app — визит из приложения; empty — пусто */
  source: 'file' | 'app' | 'empty';
  /** строку добавили (визитов больше, чем строк) */
  added: boolean;
  /** визит из приложения в этой строке */
  visitId?: string;
}

export interface DayPreview {
  date: string;
  inTemplate: boolean;
  rows: PreviewRow[];
  /** предупреждения отчёта про этот день */
  warnings: string[];
}

/**
 * Строки дня ровно так, как они будут в готовом файле: та же раскладка и те же
 * добавленные строки, что и в fillTemplate (общий planFill), только без XML.
 */
export async function previewDay(
  file: Buffer,
  visits: VisitCells[],
  date: string,
): Promise<DayPreview> {
  const { sheet, days, insertions, finalEdits, rowVisit, warnings } =
    await planFill(file, visits);
  const dayWarnings = warnings.filter((w) => w.startsWith(`${fmt(date)}:`));
  const day = days.get(date);
  if (!day) {
    return { date, inTemplate: false, rows: [], warnings: dayWarnings };
  }

  const byNum = new Map(sheet.rows.map((r) => [r.r, r]));
  // итоговый номер → исходная строка (у добавленных исходной нет)
  const original = new Map(
    day.slots.map((s) => [shiftRow(s.row, insertions), byNum.get(s.row)]),
  );
  const first = shiftRow(day.firstRow, insertions);
  const last = shiftRow(day.lastRow, insertions);

  const rows: PreviewRow[] = [];
  for (let r = first; r <= last; r++) {
    const src = original.get(r);
    const put = finalEdits.get(r);
    const value = (col: string) =>
      put?.get(col) ?? src?.cells.get(col)?.value ?? '';
    const cells = Object.fromEntries(
      PREVIEW_COLS.map((c) => [c, value(c)]),
    ) as Record<PreviewCol, string>;
    const visitId = rowVisit.get(r);
    const filledInFile = VISIT_DATA_COLS.some(
      (c) => !!src?.cells.get(c)?.value,
    );
    rows.push({
      row: r,
      num: src?.cells.get('B')?.value ?? '',
      label: value(VISIT_COLS.kind),
      cells,
      source: visitId ? 'app' : filledInFile ? 'file' : 'empty',
      added: !original.has(r),
      visitId,
    });
  }
  return { date, inTemplate: true, rows, warnings: dayWarnings };
}
