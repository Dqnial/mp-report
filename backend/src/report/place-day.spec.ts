import { addressMatch } from '../common/place-match';
import { placeDay, type DayBlock, type Slot } from './xlsx-template';

/**
 * Типичный день плана: ЛПУ в строке-заголовке, под ним пустые
 * строки «там же»; аптеки — каждая своей строкой.
 *   1  Детская поликлиника   (4 строки: 1–4)
 *   5  Медцентр                        (3 строки: 5–7)
 *   8  Фармленд Лесная 19            (1)
 *   9  Фармленд Садовая               (2 строки: 9–10, последняя — хвост дня)
 */
function day(
  plan: Record<number, string>,
  rows = 10,
  filled: number[] = [],
): DayBlock {
  let groupPlace = '';
  const slots: Slot[] = Array.from({ length: rows }, (_, k) => {
    const row = k + 1;
    const plannedPlace = plan[row] ?? '';
    if (plannedPlace) groupPlace = plannedPlace;
    return {
      row,
      numbered: true,
      free: !filled.includes(row),
      plannedPlace,
      plannedAddress: plannedPlace ? `адрес ${plannedPlace}` : '',
      groupPlace,
      groupAddress: '',
      label: '',
    };
  });
  return { date: '2026-10-12', firstRow: 1, lastRow: rows, slots };
}

const PLAN = {
  1: 'Детская поликлиника',
  5: 'Медцентр',
  8: 'Фармленд Лесная 19',
  9: 'Фармленд Садовая',
};
const v = (placeName: string | null) => ({ placeName });
const rows = (r: ReturnType<typeof placeDay>) =>
  r.placements.map((p) => (p ? `${p.row}${p.newHead ? '*' : ''}` : '—'));

describe('placeDay', () => {
  it('визиты по плану — в свою группу, по порядку, ЛПУ не вписываем', () => {
    const r = placeDay(day(PLAN), [
      v('Детская поликлиника'),
      v('детская  поликлиника'), // регистр и пробелы не важны
      v('Медцентр'),
      v('Фармленд Лесная 19'),
      v('Детская поликлиника'),
    ]);
    expect(rows(r)).toEqual(['1', '2', '5', '8', '3']);
  });

  it('визиты по плану занимают свои строки раньше, чем внеплановые', () => {
    // внеплановый введён первым, но строки Медцентр ему не достаются
    const r = placeDay(day(PLAN), [
      v('ГП 5'),
      v('Медцентр'),
      v('Медцентр'),
      v('Медцентр'),
    ]);
    expect(rows(r)).toEqual(['10*', '5', '6', '7']);
  });

  it('ЛПУ не по плану — в запасные строки в конце дня, план не теряет строк', () => {
    // в конце дня 3 запасные строки (10–12) под последней аптекой
    const r = placeDay(day(PLAN, 12), [
      v('Детская поликлиника'),
      v('ГП 5'),
      v('ГП 5'), // ложится под свой новый заголовок
    ]);
    expect(rows(r)).toEqual(['1', '10*', '11']);
    const g = r.groups.find((x) => x.place === 'ГП 5')!;
    expect(g).toMatchObject({ row: 10, capacity: 3, used: 2, inFile: false });
    // Детская сохранила все 4 строки — на экране «1/4», а не «готово»
    expect(r.groups[0]).toMatchObject({ capacity: 4, used: 1 });
  });

  it('группа плана заполнена — следующий визит туда открывает новую группу', () => {
    const r = placeDay(day(PLAN), [
      v('Медцентр'),
      v('Медцентр'),
      v('Медцентр'),
      v('Медцентр'),
    ]);
    // Медцентр 5–7 заполнен — четвёртый в запасную строку в конце дня
    expect(rows(r)).toEqual(['5', '6', '7', '10*']);
  });

  it('строки-заголовки плана под чужое ЛПУ не отдаём', () => {
    // всё, что можно, занято — свободны лишь заголовки аптек
    const full = day(PLAN, 10, [2, 3, 4, 6, 7, 10]);
    const r = placeDay(full, [v('ГП 5')]);
    expect(rows(r)).toEqual(['—']);
  });

  it('уже записанные в файле строки не занимаем', () => {
    // в Детской записаны 1 и 3 — по плану свободна строка 2
    const d = day(PLAN, 10, [1, 3]);
    const r = placeDay(d, [v('Детская поликлиника'), v('ГП 5')]);
    expect(rows(r)).toEqual(['2', '10*']);
  });

  it('новую группу открываем только там, где под ней до следующего ЛПУ пусто', () => {
    // запасная строка 10 занята — следующий свободный хвост: Медцентр 6–7
    const d = day(PLAN, 10, [10]);
    const r = placeDay(d, [v('ГП 5'), v('ГП 5')]);
    expect(rows(r)).toEqual(['6*', '7']);
  });

  it('визит без ЛПУ — в запасную строку, без заголовка', () => {
    const r = placeDay(day(PLAN), [v(null)]);
    expect(rows(r)).toEqual(['10']);
  });

  it('сводка групп плана для экрана «По плану»', () => {
    const r = placeDay(day(PLAN, 10, [1]), [v('Медцентр')]);
    expect(r.groups.map((g) => [g.place, g.used, g.capacity])).toEqual([
      ['Детская поликлиника', 1, 4],
      ['Медцентр', 1, 3],
      ['Фармленд Лесная 19', 0, 1],
      ['Фармленд Садовая', 0, 2],
    ]);
  });
});

describe('одно название — разные адреса', () => {
  // две «Фармленд» в плане одного дня: 1 — Лесная 10, 2 — Садовая 46; 3–4 запас
  const d: DayBlock = {
    date: '2026-10-12',
    firstRow: 1,
    lastRow: 4,
    slots: [
      ['Фармленд', 'Лесная 10'],
      ['Фармленд', 'Садовая 46'],
      ['', ''],
      ['', ''],
    ].map(([plannedPlace, plannedAddress], k) => ({
      row: k + 1,
      numbered: true,
      free: true,
      plannedPlace,
      plannedAddress,
      groupPlace: k < 2 ? plannedPlace : 'Фармленд',
      groupAddress: k < 2 ? plannedAddress : 'Садовая 46',
      label: '',
    })),
  };
  const at = (placeName: string, address: string | null) => ({
    placeName,
    address,
  });

  it('визит — в строку своего адреса, а не первой аптеки с тем же названием', () => {
    const r = placeDay(d, [
      at('Фармленд', 'ул. Садовая, 46'),
      at('Фармленд', 'Лесная 10'),
    ]);
    expect(r.placements.map((p) => p?.row)).toEqual([2, 1]);
  });

  it('адрес не из плана — другая аптека: новая группа, а не «там же»', () => {
    const r = placeDay(d, [at('Фармленд', 'Речная 1')]);
    expect(r.placements).toEqual([{ row: 3, newHead: true }]);
  });

  it('без адреса — в первую подходящую по названию', () => {
    const r = placeDay(d, [at('Фармленд', null)]);
    expect(r.placements[0]?.row).toBe(1);
  });

  it('нетронутую группу плана берём только в отчёте (reusePlan)', () => {
    const full: DayBlock = {
      ...d,
      slots: d.slots.map((s) => (s.row > 2 ? { ...s, free: false } : s)),
    };
    const visits = [at('Европа', 'Полевая 3')];
    expect(placeDay(full, visits).placements).toEqual([null]);
    // у «Фармленд» на Садовая под ней записанные строки — она занята; берём первую
    expect(placeDay(full, visits, { reusePlan: true }).placements).toEqual([
      { row: 1, newHead: true, replacesPlan: true },
    ]);
  });
});

describe('addressMatch', () => {
  it.each([
    ['Садовая 46', 'Садовая 46', 2],
    ['Садовая 46', 'ул. Садовая, 46', 1],
    ['Лесная 1', 'Лесная 10', 0],
    ['Лесная 10', 'Речная 5', 0],
    ['', 'Лесная 10', 1],
    [null, null, 1],
    // реальные записи: то же место, адрес записан иначе / с опечаткой
    ['Цветочная 32', 'Лесная Цветочная', 1],
    ['Цвиточная 32', 'Лесная Цветочная', 1],
    ['мкр Северный ул Береговая 22', 'Бериговая 22', 1],
    ['Садовая 46', 'Речная 46', 0],
  ])('%s / %s → %i', (a, b, want) => {
    expect(addressMatch(a, b)).toBe(want);
  });
});
