// Разбор строки, которую медпред заполнил в Excel руками, в поля визита.
// Пишет он как удобно: «Коф йог», «Кофйог», «Кoф» с латинской o, «Тррифола»,
// несколько препаратов с остатками в одной ячейке («Коф йог 7 и Вормзвин 10»).
// Распознаём нечётко; исходный текст J–M всё равно сохраняется в productsRaw.
import { VisitKind } from '@prisma/client';
import { levenshtein } from '../common/place-match';
import { PRODUCTS, type VisitProduct } from '../products';
import type { FilledRow } from '../report/xlsx-template';

/** Латиница, похожая на кириллицу, — встречается в ручном вводе. */
const HOMOGLYPHS: Record<string, string> = {
  a: 'а',
  c: 'с',
  e: 'е',
  o: 'о',
  p: 'р',
  x: 'х',
  y: 'у',
  k: 'к',
  m: 'м',
  t: 'т',
  h: 'н',
  b: 'в',
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[a-z]/g, (ch) => HOMOGLYPHS[ch] ?? ch);

/** Названия без пробелов + варианты, которые пишут иначе. */
const NAMES: { code: VisitProduct['code']; names: string[] }[] = PRODUCTS.map(
  (p) => ({
    code: p.code,
    names: [normalize(p.label).replace(/\s+/g, '')],
  }),
);
NAMES.find((n) => n.code === 'CALCIACTIV')!.names.push('кальцийактив');

/** Сколько опечаток прощаем: в коротких словах — одну, в длинных — две. */
const tolerance = (len: number) => (len >= 7 ? 2 : 1);

/**
 * Ищем препараты в тексте ячеек J–M. Текст «сжимаем» до букв и цифр
 * («Коф йог 7 и Вормзвин 10» → «кофйог7ивормзвин10») и идём слева направо:
 * в каждой позиции пробуем все названия с допуском на опечатки; число сразу
 * после названия — остаток.
 */
export function parseProducts(texts: string[]): VisitProduct[] {
  const found = new Map<string, VisitProduct>();
  for (const text of texts) {
    const s = normalize(text).replace(/[^а-яa-z0-9]/g, '');
    let i = 0;
    while (i < s.length) {
      if (/\d/.test(s[i])) {
        i++;
        continue;
      }
      let best: {
        code: VisitProduct['code'];
        end: number;
        dist: number;
      } | null = null;
      for (const { code, names } of NAMES) {
        for (const name of names) {
          for (const len of [name.length, name.length - 1, name.length + 1]) {
            const chunk = s.slice(i, i + len);
            if (chunk.length !== len || /\d/.test(chunk)) continue;
            const dist = levenshtein(chunk, name);
            if (dist <= tolerance(name.length) && (!best || dist < best.dist)) {
              best = { code, end: i + len, dist };
            }
          }
        }
      }
      if (!best) {
        i++;
        continue;
      }
      const stock = s.slice(best.end).match(/^\d+/)?.[0];
      if (!found.has(best.code)) {
        found.set(
          best.code,
          stock == null
            ? { code: best.code }
            : { code: best.code, stock: Number(stock) },
        );
      }
      i = best.end + (stock?.length ?? 0);
    }
  }
  return [...found.values()];
}

/** Аптека или врач — по специальности; метки в колонке C не соблюдают. */
export function guessKind(cells: Record<string, string>): VisitKind {
  const specialty = normalize(cells.H);
  if (/провизор|фармацевт|зав\.?\s*ап/.test(specialty))
    return VisitKind.PHARMACY;
  if (specialty) return VisitKind.DOCTOR;
  if (/аптек/.test(normalize(cells.E))) return VisitKind.PHARMACY;
  return /^аптек/.test(normalize(cells.C))
    ? VisitKind.PHARMACY
    : VisitKind.DOCTOR;
}

const orNull = (s: string) => s.replace(/\s+/g, ' ').trim() || null;

export interface ImportedVisitData {
  date: string;
  templateRow: number;
  kind: VisitKind;
  placeName: string | null;
  address: string | null;
  fullName: string | null;
  specialty: string | null;
  phone: string | null;
  products: VisitProduct[];
  productsRaw: string | null;
  comment: string | null;
}

/**
 * Пустое ЛПУ/адрес в строке значит «там же, что в строке-заголовке выше»
 * (так устроен план: ЛПУ, под ним N врачей) — берём от группы.
 */
export function rowToVisit({
  date,
  row,
  cells,
  groupPlace,
  groupAddress,
}: FilledRow): ImportedVisitData {
  const place = cells.E || groupPlace;
  const productCells = ['J', 'K', 'L', 'M']
    .map((c) => cells[c])
    .filter(Boolean);
  return {
    date,
    templateRow: row,
    kind: guessKind({ ...cells, E: place }),
    placeName: orNull(place),
    address: orNull(cells.F || (cells.E ? '' : groupAddress)),
    fullName: orNull(cells.G),
    specialty: orNull(cells.H),
    phone: orNull(cells.I),
    products: parseProducts(productCells),
    productsRaw: orNull(productCells.join(' | ')),
    comment: orNull(cells.N),
  };
}
