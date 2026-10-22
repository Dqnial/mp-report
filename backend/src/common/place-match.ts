// Одно ли это место: название + адрес. У сетей аптек («Фармленд») одно название
// на десятки адресов — по одному названию их не различить.

/** Сравнение названий и адресов: регистр, ё/е, кавычки, №, точки и пробелы не важны. */
export const normPlace = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/["«»'`№#.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Сколько правок (вставка/удаление/замена буквы) отделяет одну строку от другой. */
export function levenshtein(a: string, b: string) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Слова адреса: названия (от 4 букв — «ул», «мкр», «уг» не в счёт) и номера. */
function addressParts(s: string) {
  const all = normPlace(s).split(' ').filter(Boolean);
  return {
    streets: all.filter((w) => !/\d/.test(w) && w.length >= 4),
    numbers: all.filter((w) => /\d/.test(w)),
  };
}

/** Одна улица с допуском на опечатку: «Цвиточная» = «Цветочная», «Береговая» = «Бериговая». */
const sameWord = (a: string, b: string) =>
  a === b ||
  levenshtein(a, b) <=
    Math.max(1, Math.floor(Math.min(a.length, b.length) / 4));

/**
 * Насколько совпадают адреса: 2 — одинаковые, 1 — то же место (один пуст или
 * общая улица с допуском на опечатку, а номера домов не противоречат:
 * «Цветочная 32» и «Лесная Цветочная», «ул. Береговая 22» и «Бериговая 22»),
 * 0 — разные места («Лесная 10» и «Садовая 46»; «Лесная 1» и «Лесная 10»).
 */
export function addressMatch(a?: string | null, b?: string | null) {
  const x = normPlace(a ?? '');
  const y = normPlace(b ?? '');
  if (!x || !y) return 1;
  if (x === y) return 2;
  const pa = addressParts(x);
  const pb = addressParts(y);
  const street = pa.streets.some((w) => pb.streets.some((v) => sameWord(w, v)));
  const numbersConflict =
    pa.numbers.length > 0 &&
    pb.numbers.length > 0 &&
    !pa.numbers.some((n) => pb.numbers.includes(n));
  // улиц нет ни в одном («10» и «10») — решают номера
  const noStreets = !pa.streets.length || !pb.streets.length;
  if (numbersConflict) return 0;
  return street || (noStreets && pa.numbers.some((n) => pb.numbers.includes(n)))
    ? 1
    : 0;
}

/** Совпадение места: 0 — другое место, 1 — то же (адрес не противоречит), 2 — то же и адрес тот же. */
export function placeMatch(
  a: { name?: string | null; address?: string | null },
  b: { name?: string | null; address?: string | null },
) {
  if (!a.name || normPlace(a.name) !== normPlace(b.name ?? '')) return 0;
  return addressMatch(a.address, b.address);
}
