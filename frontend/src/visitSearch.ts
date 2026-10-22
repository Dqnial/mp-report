// Поиск, фильтры и сортировка визитов — одинаково для дня, месяца и «всех».
import type { LocalVisit } from './offline/db';
import { productText } from './products';
import { missingFields } from './visitFields';

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/**
 * Подходит ли визит под запрос: ФИО, ЛПУ/аптека, адрес, специальность,
 * комментарий, договорённость, препараты; телефон — по цифрам («701123»
 * находит «8 701 123 45 67»). Регистр и ё/е не важны.
 */
export function matchesQuery(v: LocalVisit, q: string) {
  const text = norm(q.trim());
  if (!text) return true;
  const hay = norm(
    [
      v.fullName,
      v.placeName,
      v.address,
      v.specialty,
      v.comment,
      v.agreement,
      v.fact,
      v.deviation,
      v.productsRaw,
      v.products.map(productText).join(' '),
    ]
      .filter(Boolean)
      .join(' '),
  );
  if (hay.includes(text)) return true;
  const digits = q.replace(/\D/g, '');
  return (
    digits.length >= 3 && (v.phone ?? '').replace(/\D/g, '').includes(digits)
  );
}

export type KindFilter = 'all' | 'DOCTOR' | 'PHARMACY';

export interface VisitFilters {
  kind: KindFilter;
  /** чего-то не хватает (ФИО, телефона…) — только визиты из приложения */
  gaps: boolean;
  /** ещё не дошли до сервера */
  unsent: boolean;
}

export function applyFilters(list: LocalVisit[], f: VisitFilters) {
  return list.filter(
    (v) =>
      (f.kind === 'all' || v.kind === f.kind) &&
      (!f.gaps || (!v.fromFile && missingFields(v).length > 0)) &&
      (!f.unsent || v.syncState !== 'synced'),
  );
}

export type SortMode = 'order' | 'newest' | 'place' | 'name';

export const SORT_LABELS: Record<SortMode, string> = {
  order: 'По порядку (как в отчёте)',
  newest: 'Сначала новые',
  place: 'По ЛПУ / аптеке',
  name: 'По ФИО',
};

const byText = (a: string | null, b: string | null) =>
  // пустые — в конец
  !a ? (b ? 1 : 0) : !b ? -1 : a.localeCompare(b, 'ru');

/** По порядку: дни по возрастанию, в дне — строки файла, затем по времени ввода. */
const dayOrder = (a: LocalVisit, b: LocalVisit) =>
  a.date.localeCompare(b.date) ||
  (a.templateRow ?? Infinity) - (b.templateRow ?? Infinity) ||
  a.createdAt.localeCompare(b.createdAt);

export function sortVisits(list: LocalVisit[], mode: SortMode) {
  const out = [...list];
  if (mode === 'order') return out.sort(dayOrder);
  if (mode === 'newest')
    return out.sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
  if (mode === 'place')
    return out.sort(
      (a, b) => byText(a.placeName, b.placeName) || dayOrder(a, b),
    );
  return out.sort((a, b) => byText(a.fullName, b.fullName) || dayOrder(a, b));
}
