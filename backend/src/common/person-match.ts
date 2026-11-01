// Один ли это человек: ФИО пишут по-разному (без отчества, с опечаткой),
// телефон и ФИО со временем меняются.
import { levenshtein } from './place-match';

/** ФИО для сравнения: регистр, «ё», знаки и лишние пробелы не важны. */
export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Насколько совпадают ФИО:
 * same — одинаковые; typo — фамилия и имя те же, отчество отличается на
 * опечатку (до 2 букв); partial — фамилия и имя те же, у одной записи
 * отчества нет (это могут быть и тёзки — решает место/специальность/телефон);
 * none — разные люди.
 */
export function nameMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): 'same' | 'typo' | 'partial' | 'none' {
  const x = normName(a ?? '');
  const y = normName(b ?? '');
  if (!x || !y) return 'none';
  if (x === y) return 'same';
  const [xs, ys] = [x.split(' '), y.split(' ')];
  if (xs.length < 2 || ys.length < 2) return 'none';
  if (xs[0] !== ys[0] || xs[1] !== ys[1]) return 'none';
  const rx = xs.slice(2).join(' ');
  const ry = ys.slice(2).join(' ');
  if (rx && ry) return levenshtein(rx, ry) <= 2 ? 'typo' : 'none';
  return 'partial';
}

/** Один и тот же номер: последние 10 цифр (8 701… и +7 701… — одно). */
export function samePhone(a?: string | null, b?: string | null) {
  const x = (a ?? '').replace(/\D/g, '').slice(-10);
  const y = (b ?? '').replace(/\D/g, '').slice(-10);
  return x.length === 10 && x === y;
}
