// Работа с Excel-шаблоном руководителя без пересборки книги.
//
// Компания требует не менять файл — только вписывать значения в пустые ячейки.
// Библиотеки вроде exceljs пересобирают пакет (теряют externalLinks, ломают
// definedNames), поэтому открываем xlsx как zip, правим лишь XML листа визитов,
// а все остальные части копируем как есть (примитивы — xlsx/xlsx-xml.ts).
import JSZip from 'jszip';
import { shortRu as fmt } from '../common/dates';
import { nameMatch, normName, samePhone } from '../common/person-match';
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

/**
 * Колонки визита. G–I — кто (ФИО, специальность, телефон), J–N — что было
 * на визите (препараты, комментарий). Строка с данными в J–N — сделанный
 * визит; только с G–I — запланированный врач (план с врачами); пустая — для
 * визита. E/F — ЛПУ и адрес плана.
 */
const PERSON_COLS = ['G', 'H', 'I'];
const DONE_COLS = ['J', 'K', 'L', 'M', 'N'];

/** Запланированный врач/провизор: строка плана с ФИО, но без визита. */
export interface PlannedPerson {
  fullName: string;
  specialty: string;
  phone: string;
}

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
  /** визита в строке нет (J–N пусты); у запланированного врача — тоже free */
  free: boolean;
  /**
   * строка плана с врачом: сначала её занимает визит к нему; не пришёл —
   * может занять другой визит в это место. Нет визита — в отчёт не попадает
   */
  planned?: PlannedPerson;
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
        : // строка с датой есть всегда, даже если номеров нет (день из одной строки)
          block.slice(0, Math.max(1, block.findLastIndex(isSlotNumber) + 1));
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
      const v = (c: string) => r.cells.get(c)?.value ?? '';
      const done = DONE_COLS.some((c) => v(c));
      const person = PERSON_COLS.some((c) => v(c));
      return {
        row: r.r,
        numbered: isSlotNumber(r),
        free: !done,
        ...(!done &&
          person && {
            planned: { fullName: v('G'), specialty: v('H'), phone: v('I') },
          }),
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
  /** визит именно к врачу этой строки плана (его данные можно не повторять) */
  matched?: boolean;
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
  /** врачи из плана (строки с ФИО без визита) и были ли у них сегодня */
  doctors: (PlannedPerson & { row: number; visited: boolean })[];
}

export interface DayPlacement {
  /** по индексу визита; null — не хватило строк */
  placements: (Placement | null)[];
  groups: PlanGroup[];
}

/**
 * Раскладка визитов дня по строкам — по тому, как устроен план:
 * 0) визит к врачу из плана — в его строку;
 * 1) визит в ЛПУ из плана — в первую свободную строку группы этого ЛПУ,
 *    а если таких нет — в строку врача, к которому визита нет (провизор
 *    сменился, принял другой врач);
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
  visits: {
    placeName?: string | null;
    address?: string | null;
    fullName?: string | null;
    phone?: string | null;
  }[],
  { reusePlan = false }: { reusePlan?: boolean } = {},
): DayPlacement {
  const rows = day.slots.map((s) => ({
    ...s,
    head: !!s.plannedPlace || !!s.boundary,
    inFile: !!s.plannedPlace,
    newHead: false,
    replacesPlan: false,
    matched: false,
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
  /** пустая строка: не занята и в плане на ней никого */
  const open = (r: (typeof rows)[number]) => r.free && !r.planned;

  // один телефон бывает на всю регистратуру — без ФИО он годится, а при
  // другом ФИО совпасть должно хотя бы имя (фамилию меняют, имя — нет)
  const sameGiven = (a: string, b: string) => {
    const x = normName(a).split(' ')[1];
    return !!x && x === normName(b).split(' ')[1];
  };
  /**
   * Насколько визит похож на запланированного врача (0 — не он). ФИО и
   * телефон со временем меняются, поэтому: ФИО то же или с опечаткой в
   * отчестве; без отчества — если то же место или телефон; ФИО исправили —
   * по телефону. При равенстве — в том же месте, что визит.
   */
  const plannedScore = (
    v: (typeof visits)[number],
    r: (typeof rows)[number],
  ) => {
    if (!r.planned) return 0;
    const name = nameMatch(v.fullName, r.planned.fullName);
    const phone = samePhone(v.phone, r.planned.phone);
    const place = v.placeName
      ? placeMatch(
          { name: v.placeName, address: v.address },
          { name: r.groupPlace, address: r.groupAddress },
        )
      : 0;
    const who =
      name === 'same' || name === 'typo'
        ? 3
        : name === 'partial' && (place > 0 || phone)
          ? 2
          : phone &&
              (!v.fullName?.trim() || sameGiven(v.fullName, r.planned.fullName))
            ? 1
            : 0;
    return who && who * 10 + place;
  };

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
    for (const test of [open, (r: (typeof rows)[number]) => r.free]) {
      for (const { h } of candidates) {
        const [, end] = groupOf(h);
        for (let i = h; i < end; i++) if (test(rows[i])) return i;
      }
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
      if (!open(rows[i]) || rows[i].head) return false;
      const [, end] = groupOf(i);
      return rows.slice(i, end).every(open);
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
      // врачи без визитов в отчёт не попадают — их строки тоже можно занять
      if (rows.slice(h, end).every((r) => r.free)) return h;
    }
    return -1;
  };

  const placements: (Placement | null)[] = visits.map(() => null);
  const take = (
    vi: number,
    i: number,
    open?: { place: string; address: string },
    matched = false,
  ) => {
    rows[i].free = false;
    rows[i].matched = matched;
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
      ...(matched && { matched }),
    };
  };

  // 0) к врачу из плана — в его строку. Сначала самые верные пары по всему
  // дню: визит без ФИО с общим телефоном не должен занять строку врача раньше,
  // чем дойдёт очередь до визита к нему самому
  visits
    .flatMap((v, vi) =>
      v.fullName?.trim() || v.phone?.trim()
        ? rows.flatMap((r, i) => {
            const score = r.free ? plannedScore(v, r) : 0;
            return score ? [{ vi, i, score }] : [];
          })
        : [],
    )
    .sort((a, b) => b.score - a.score)
    .forEach(({ vi, i }) => {
      if (!placements[vi] && rows[i].free) take(vi, i, undefined, true);
    });
  // 1) по плану
  visits.forEach((v, vi) => {
    if (placements[vi]) return;
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
        doctors: members.flatMap((r) =>
          r.planned ? [{ ...r.planned, row: r.row, visited: r.matched }] : [],
        ),
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
    // и врач из плана: иначе добавленные строки — не хвост дня, визит не по
    // плану не сможет открыть в них своё ЛПУ
    boundary: !last.plannedPlace && (!last.free || !!last.planned),
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

type RowMap = (row: number) => number;

/** A5, $A$5, A5:B9, $2:$4 — сдвигаем номера строк. */
const shiftRef = (ref: string, map: RowMap) =>
  ref
    .split(':')
    .map((part) =>
      part.replace(
        /^(\$?[A-Z]{0,3}\$?)(\d+)$/,
        (_, c: string, r: string) => c + String(map(Number(r))),
      ),
    )
    .join(':');

/** Ссылки в атрибутах вне строк листа: объединения, фильтр, выделение… */
const shiftSheetRefs = (xml: string, map: RowMap, changed: boolean) =>
  changed
    ? xml
        .replace(
          /\b(ref|sqref|topLeftCell|activeCell)="([^"]*)"/g,
          (_, name: string, v: string) =>
            `${name}="${v
              .split(' ')
              .map((r) => shiftRef(r, map))
              .join(' ')}"`,
        )
        .replace(/<rowBreaks\b[\s\S]*?<\/rowBreaks>/, (b) =>
          b.replace(
            /(<brk\b[^>]*?\sid=")(\d+)"/g,
            (_, p: string, r: string) => `${p}${map(Number(r))}"`,
          ),
        )
    : xml;

/** День сжался до одной строки: объединение A5:A5 Excel считает ошибкой файла. */
function dropSingleCellMerges(xml: string) {
  let dropped = 0;
  const out = xml.replace(/<mergeCell ref="([A-Z]+\d+):\1"\s*\/>/g, () => {
    dropped++;
    return '';
  });
  if (!dropped) return xml;
  return out
    .replace(/<mergeCells\b[^>]*>\s*<\/mergeCells>/, '')
    .replace(
      /(<mergeCells\b[^>]*?\scount=")(\d+)"/,
      (_, p: string, n: string) => `${p}${Number(n) - dropped}"`,
    );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Именованные диапазоны книги, указывающие на лист визитов. */
function shiftDefinedNames(wb: string, sheetName: string, map: RowMap) {
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
        (__, pre: string, ref: string) => pre + shiftRef(ref, map),
      ) +
      close,
  );
}

/** Можно ли безопасно вставлять строки в этот лист. */
async function canInsertRows(sheet: LoadedSheet) {
  const unsafe =
    /<f[\s>]|<formula[\s>]|<drawing\b|<legacyDrawing\b|<tableParts\b|<oleObjects\b|<controls\b/;
  if (unsafe.test(sheet.xml)) return false;
  // на лист ссылаются другие части книги (формулы других листов, диаграммы…);
  // docProps — свойства документа: там Excel перечисляет имена листов, это
  // не ссылки (иначе строки не добавлялись бы ни в одном сохранённом им файле)
  const needle = escapeXml(sheet.name);
  for (const [path, f] of Object.entries(sheet.zip.files)) {
    if (f.dir || path === sheet.path || path === 'xl/workbook.xml') continue;
    if (path.startsWith('docProps/')) continue;
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
  /** строки без визита, которые не попадут в файл (номера после вставок) */
  removed: Set<number>;
  /** итоговый номер строки → колонка → значение */
  finalEdits: Map<number, Map<string, string>>;
  /** итоговый номер строки → id визита */
  rowVisit: Map<number, string>;
  warnings: string[];
  placed: number;
}

/**
 * Визит «из файла», исправленный или удалённый в приложении: его строка в
 * шаблоне уже заполнена, и экспорт её перезаписывает.
 */
export interface FileRowEdit {
  /** номер строки в шаблоне */
  row: number;
  /** null — визит удалили: колонки визита в строке очищаются */
  visit: VisitCells | null;
  /** препараты не правили — J–M как в файле (там бывает то, что не распознали) */
  keepProducts?: boolean;
}

/**
 * Перезапись строк исправленных визитов «из файла». План в строке (E/F)
 * остаётся, если визит в том же месте; другое место — пишем его в строку,
 * а строке ниже «там же» возвращаем прежнее ЛПУ, чтобы она не переехала.
 */
function applyFileEdits(
  edits: FileRowEdit[],
  days: Map<string, DayBlock>,
  insertions: Insertion[],
  finalEdits: Map<number, Map<string, string>>,
  rowVisit: Map<number, string>,
) {
  const slotAt = new Map<number, { day: DayBlock; i: number }>();
  for (const day of days.values()) {
    day.slots.forEach((s, i) => slotAt.set(s.row, { day, i }));
  }
  const putAt = (row: number, put: Map<string, string>) => {
    const to = shiftRow(row, insertions);
    finalEdits.set(to, new Map([...(finalEdits.get(to) ?? []), ...put]));
    return to;
  };

  for (const { row, visit: v, keepProducts } of edits) {
    const at = slotAt.get(row);
    if (!at) continue; // в этом шаблоне такой строки нет
    const slot = at.day.slots[at.i];
    const put = new Map<string, string>([
      [VISIT_COLS.fullName, v?.fullName?.trim() ?? ''],
      [VISIT_COLS.specialty, v?.specialty?.trim() ?? ''],
      [VISIT_COLS.phone, v?.phone?.trim() ?? ''],
      [VISIT_COLS.comment, v?.comment?.trim() ?? ''],
    ]);
    if (!v || !keepProducts) {
      VISIT_COLS.products.forEach((c, i) => put.set(c, v?.products[i] ?? ''));
    }
    const moved =
      !!v?.placeName?.trim() &&
      placeMatch(
        { name: v.placeName, address: v.address },
        { name: slot.groupPlace, address: slot.groupAddress },
      ) === 0;
    if (v && moved) {
      put.set(VISIT_COLS.placeName, v.placeName!.trim());
      put.set(VISIT_COLS.address, v.address?.trim() ?? '');
      const next = at.day.slots[at.i + 1];
      // занята визитом, за врачом из плана или в неё только что лёг визит
      const nextUsed =
        next &&
        (!next.free ||
          !!next.planned ||
          finalEdits.has(shiftRow(next.row, insertions)));
      if (nextUsed && !next.plannedPlace && slot.groupPlace) {
        putAt(
          next.row,
          new Map([
            [VISIT_COLS.placeName, slot.groupPlace],
            [VISIT_COLS.address, slot.groupAddress],
          ]),
        );
      }
    }
    const to = putAt(row, put);
    if (v?.id) rowVisit.set(to, v.id);
    else rowVisit.delete(to);
  }
}

/** Номер строки после вставок → итоговый; удалённая — как предыдущая оставшаяся. */
const afterRemoval = (r: number, removed: Set<number>) => {
  let n = r;
  for (const x of removed) if (x <= r) n--;
  return n;
};

/**
 * В отчёт попадают только строки с визитами: есть в плане, но визита нет — строки
 * нет. Визиты дня идут подряд сверху вниз; сетка дня (первая строка с датой,
 * объединённый день недели, последняя с жирной границей) остаётся на месте,
 * лишние строки удаляем из её середины.
 * В дне без единого визита строки остаются как план, но без ФИО. Нельзя менять
 * число строк (см. canInsertRows) — только стираем ФИО, строки остаются пустыми.
 */
function compactDays(
  days: Map<string, DayBlock>,
  rowsByNum: Map<number, Row>,
  insertions: Insertion[],
  edits: Map<number, Map<string, string>>,
  rowVisit: Map<number, string>,
  placedRows: Set<number>,
  canRemove: boolean,
  warnings: string[],
) {
  const removed = new Set<number>();
  const finalEdits = new Map<number, Map<string, string>>();
  const finalVisit = new Map<number, string>();
  const movedEdits = new Map<number, Map<string, string>>();
  const movedVisit = new Map<number, string>();

  for (const day of days.values()) {
    const source = new Map(
      day.slots.map((s) => [shiftRow(s.row, insertions), rowsByNum.get(s.row)]),
    );
    const entries: { r: number; src?: Row; put?: Map<string, string> }[] = [];
    const last = shiftRow(day.lastRow, insertions);
    for (let r = shiftRow(day.firstRow, insertions); r <= last; r++) {
      entries.push({ r, src: source.get(r), put: edits.get(r) });
    }
    const val = (e: (typeof entries)[number], col: string) =>
      e.put?.get(col) ?? e.src?.cells.get(col)?.value ?? '';
    const isKept = (e: (typeof entries)[number]) =>
      placedRows.has(e.r) ||
      rowVisit.has(e.r) ||
      DONE_COLS.some((c) => !!val(e, c));
    const kept = entries.filter(isKept);

    // ЛПУ строки, если его заголовок окажется удалён
    if (kept.length && canRemove) {
      let group = { place: '', address: '' };
      let written = '';
      for (const e of entries) {
        const place = val(e, VISIT_COLS.placeName);
        if (place) {
          group = { place, address: val(e, VISIT_COLS.address) };
        }
        if (!isKept(e)) continue;
        const key = `${group.place}|${group.address}`;
        if (!place && group.place && key !== written) {
          e.put = new Map(e.put);
          e.put.set(VISIT_COLS.placeName, group.place);
          if (!val(e, VISIT_COLS.address)) {
            e.put.set(VISIT_COLS.address, group.address);
          }
        }
        written = key;
      }
    }

    if (!kept.length || !canRemove) {
      for (const e of entries) {
        const put = new Map(e.put);
        if (!isKept(e)) {
          for (const c of PERSON_COLS) if (val(e, c)) put.set(c, '');
        }
        if (put.size) movedEdits.set(e.r, put);
        const id = rowVisit.get(e.r);
        if (id) movedVisit.set(e.r, id);
      }
      continue;
    }

    const targets =
      kept.length === 1
        ? [entries[0]]
        : [...entries.slice(0, kept.length - 1), entries[entries.length - 1]];
    const numbered = day.slots.some((s) => s.numbered);
    kept.forEach((from, i) => {
      const to = targets[i];
      const put = new Map<string, string>();
      const cols = new Set([
        ...(from.src?.cells.keys() ?? []),
        ...(from.put?.keys() ?? []),
        ...(to.src?.cells.keys() ?? []),
      ]);
      for (const col of cols) {
        if (col === 'A' || col === 'B' || col === 'D') continue;
        const value = val(from, col);
        if (value !== (to.src?.cells.get(col)?.value ?? '')) {
          put.set(col, value);
        }
      }
      const num = String(i + 1);
      if (numbered && (to.src?.cells.get('B')?.value ?? '') !== num) {
        put.set('B', num);
      }
      if (put.size) movedEdits.set(to.r, put);
      const id = rowVisit.get(from.r);
      if (id) movedVisit.set(to.r, id);
    });
    const left = new Set(targets.map((t) => t.r));
    for (const e of entries) if (!left.has(e.r)) removed.add(e.r);

    const added = kept.length - day.slots.length;
    if (added > 0) {
      warnings.push(
        `${fmt(day.date)}: визитов больше, чем строк в шаблоне — добавил строк в конце дня: ${added}`,
      );
    }
  }

  for (const [r, put] of movedEdits) {
    finalEdits.set(afterRemoval(r, removed), put);
  }
  for (const [r, id] of movedVisit) {
    finalVisit.set(afterRemoval(r, removed), id);
  }
  return { removed, finalEdits, rowVisit: finalVisit };
}

async function planFill(
  file: Buffer,
  visits: VisitCells[],
  fileEdits: FileRowEdit[] = [],
): Promise<FillPlan> {
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
    placedRows: number[];
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
    const placedRows: number[] = [];
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
      // «Врач»/«Аптека» — по факту: в плане колонку заполняют как попало, и
      // строку мог занять другой визит
      if (v.kind) set(VISIT_COLS.kind, KIND_LABEL[v.kind]);
      set(VISIT_COLS.fullName, v.fullName);
      set(VISIT_COLS.specialty, v.specialty);
      set(VISIT_COLS.phone, v.phone);
      v.products
        .slice(0, 4)
        .forEach((pr, i) => set(VISIT_COLS.products[i], pr));
      set(VISIT_COLS.comment, v.comment);
      // в строке врача из плана лёг другой визит — от врача ничего не остаётся
      if (slot.planned && !p.matched) {
        for (const c of PERSON_COLS) if (!put.has(c)) put.set(c, '');
      }
      edits.set(p.row, put);
      placedRows.push(p.row);
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
    }
    dayEdits.push({ day, edits, ids, placedRows });
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
  const placedFinal = new Set<number>();
  for (const { day, edits, ids, placedRows } of dayEdits) {
    const before = insertions
      .filter((i) => i.at < day.lastRow)
      .reduce((n, i) => n + i.count, 0);
    for (const [r, put] of edits) {
      if (put.size) finalEdits.set(r + before, put);
    }
    for (const [r, id] of ids) rowVisit.set(r + before, id);
    for (const r of placedRows) placedFinal.add(r + before);
  }
  applyFileEdits(fileEdits, days, insertions, finalEdits, rowVisit);
  const compacted = compactDays(
    days,
    rowsByNum,
    insertions,
    finalEdits,
    rowVisit,
    placedFinal,
    canInsert,
    warnings,
  );
  return {
    sheet,
    days,
    insertions,
    warnings,
    placed,
    ...compacted,
  };
}

export async function fillTemplate(
  file: Buffer,
  visits: VisitCells[],
  fileEdits: FileRowEdit[] = [],
): Promise<FillResult> {
  const { sheet, insertions, removed, finalEdits, warnings, placed } =
    await planFill(file, visits, fileEdits);

  // каждая колонка правится один раз, так что исходная разметка остальных
  // ячеек строки остаётся на месте
  const applyEdits = (row: Row, put?: Map<string, string>) => {
    let rowXml = row.xml;
    for (const [col, val] of put ?? []) {
      rowXml = setCellInRow(rowXml, `${col}${row.r}`, val, row.cells.get(col));
    }
    return rowXml;
  };

  const changed = insertions.length > 0 || removed.size > 0;
  const toFinal: RowMap = (r) => afterRemoval(shiftRow(r, insertions), removed);

  // собираем XML листа: меняются только тронутые и сдвинутые строки
  let xml = '';
  let pos = 0;
  for (const row of sheet.rows) {
    const shifted = shiftRow(row.r, insertions);
    const gone = removed.has(shifted);
    const to = afterRemoval(shifted, removed);
    const insertHere = insertions.find((i) => i.at === row.r);
    const put = gone ? undefined : finalEdits.get(to);
    if (!insertHere && !gone && to === row.r && !put?.size) continue;

    let out = '';
    if (insertHere) {
      for (let k = 0; k < insertHere.count; k++) {
        const n = shifted - insertHere.count + k;
        if (removed.has(n)) continue;
        const m = afterRemoval(n, removed);
        out += applyEdits(blankRow(insertHere.source, m), finalEdits.get(m));
      }
    }
    if (!gone) {
      const filled = applyEdits(row, put);
      out += to === row.r ? filled : renumberRow(filled, to);
    }
    xml +=
      shiftSheetRefs(sheet.xml.slice(pos, row.start), toFinal, changed) + out;
    pos = row.start + row.xml.length;
  }
  xml += shiftSheetRefs(sheet.xml.slice(pos), toFinal, changed);
  if (changed) xml = dropSingleCellMerges(xml);

  // без createFolders: иначе JSZip добавит в архив записи папок «xl/», «xl/worksheets/»
  sheet.zip.file(sheet.path, xml, { createFolders: false });
  if (changed) {
    const wb = (await readPart(sheet.zip, 'xl/workbook.xml'))!;
    const shifted = shiftDefinedNames(wb, sheet.name, toFinal);
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
  /**
   * file — визит, уже записанный в шаблоне; app — визит из приложения;
   * empty — пусто (день без визитов: только план)
   */
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
  fileEdits: FileRowEdit[] = [],
): Promise<DayPreview> {
  const { sheet, days, insertions, removed, finalEdits, rowVisit, warnings } =
    await planFill(file, visits, fileEdits);
  const dayWarnings = warnings.filter((w) => w.startsWith(`${fmt(date)}:`));
  const day = days.get(date);
  if (!day) {
    return { date, inTemplate: false, rows: [], warnings: dayWarnings };
  }

  const byNum = new Map(sheet.rows.map((r) => [r.r, r]));
  // итоговый номер → исходная строка (у добавленных исходной нет)
  const toFinal = (r: number) => afterRemoval(shiftRow(r, insertions), removed);
  const original = new Map(
    day.slots
      .filter((s) => !removed.has(shiftRow(s.row, insertions)))
      .map((s) => [toFinal(s.row), byNum.get(s.row)]),
  );
  const first = toFinal(day.firstRow);
  const last = toFinal(day.lastRow);

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
    // с учётом правок: удалённый визит «из файла» оставляет строку пустой
    const done = DONE_COLS.some((c) => !!value(c));
    rows.push({
      row: r,
      num: value('B'),
      label: value(VISIT_COLS.kind),
      cells,
      source: visitId ? 'app' : done ? 'file' : 'empty',
      added: !original.has(r),
      visitId,
    });
  }
  return { date, inTemplate: true, rows, warnings: dayWarnings };
}
