// Сводка на листе врачей: все специальности базы с числом врачей, «Всего»,
// «Аптек», врачи по потенциалу — формулами Excel (с уже посчитанным значением).
//
// Специальность пишут как придётся («воп», «ВОП фильтр», «гиниколог»), поэтому
// написания сводятся в группы; формула группы считает ровно её написания —
// каждый врач попадает в одну строку, и сумма сходится со «Всего врачей».

/** Группа по написанию; порядок важен: «воп гастроэнтеролог» — ВОП, «терапевт дневного» — терапевт. */
const GROUPS: [string, RegExp][] = [
  ['ВОП', /воп/],
  ['Педиатр', /педиатр|фильтр\s+детск|детск\S*\s+фильтр/],
  ['Терапевт', /терапевт/],
  ['Гинеколог', /гин[еи]колог/],
  ['Гастроэнтеролог', /гастро/],
  ['Хирург', /хирург/],
  ['Травматолог', /трав?мат/],
  ['ЛОР', /(^|\s)лор(\s|$)/],
  ['Эндокринолог', /эндокрин/],
  ['Невролог', /невр/],
  ['Кардиолог', /кардио/],
  ['Стоматолог', /стомат/],
  ['Дерматолог', /дерма/],
  ['Проктолог', /прокт/],
  ['Пульмонолог', /пульмон/],
  ['Реабилитолог', /реабил/],
  ['Инфекционист', /инфекц/],
  ['Эндоскопист', /эндоскоп/],
  ['Врач УЗИ', /узи/],
  ['Врач дневного стационара', /днев/],
  ['Главная медсестра', /медсестр|гл\.?\s*мед|гл\.?\s*мс/],
  ['Фельдшер', /фельдш/],
];

const NO_SPECIALTY = 'Не указана';

export function specialtyGroup(raw: string) {
  const s = raw.toLowerCase().replace(/ё/g, 'е').trim();
  if (!s) return NO_SPECIALTY;
  const found = GROUPS.find(([, re]) => re.test(s))?.[0];
  return found ?? raw.trim()[0].toUpperCase() + raw.trim().slice(1);
}

export interface SpecialtyRow {
  label: string;
  /** написания как в файле (без повторов по регистру — COUNTIF его не различает) */
  spellings: string[];
  count: number;
}

/** Группы специальностей: чаще встречающиеся — выше, «Не указана» — в конце. */
export function specialtyRows(specialties: string[]): SpecialtyRow[] {
  const groups = new Map<string, SpecialtyRow>();
  for (const raw of specialties) {
    const label = specialtyGroup(raw);
    const g = groups.get(label) ?? { label, spellings: [], count: 0 };
    const spelling = raw.trim();
    if (
      spelling &&
      !g.spellings.some((x) => x.toLowerCase() === spelling.toLowerCase())
    ) {
      g.spellings.push(spelling);
    }
    g.count++;
    groups.set(label, g);
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.label === NO_SPECIALTY) - Number(b.label === NO_SPECIALTY) ||
      b.count - a.count ||
      a.label.localeCompare(b.label, 'ru'),
  );
}

/** Текст для критерия COUNTIF: кавычки удваиваются, * ? ~ — буквально. */
const criterion = (s: string) =>
  `"${s.replace(/[*?~]/g, '~$&').replace(/"/g, '""')}"`;

export interface SummaryInput {
  /** колонки листа врачей и диапазон строк данных */
  cols: { fullName: string; specialty: string; potential?: string };
  first: number;
  last: number;
  doctors: { specialty?: string; potential?: string }[];
  /** лист аптек — для «Аптек»: имя, колонки, строки, сколько разных аптек */
  pharmacies?: {
    sheet: string;
    place: string;
    address?: string;
    first: number;
    last: number;
    count: number;
  };
}

export interface SummaryCell {
  text?: string;
  formula?: string;
  value?: number;
  /** заголовок / подпись / число — для оформления */
  kind: 'title' | 'label' | 'number';
}

/** Сводка: строки (по порядку) из пар [подпись, число]. */
export function summaryTable(input: SummaryInput) {
  const { cols, first, last } = input;
  const range = (col: string) => `$${col}$${first}:$${col}$${last}`;
  const rows: [SummaryCell, SummaryCell][] = [];
  const title = (a: string, b: string) =>
    rows.push([
      { text: a, kind: 'title' },
      { text: b, kind: 'title' },
    ]);
  const line = (label: string, formula: string, value: number) =>
    rows.push([
      { text: label, kind: 'label' },
      { formula, value, kind: 'number' },
    ]);
  const byLabel = new Map<string, number>();

  title('Специалистов в базе', 'Врачей');
  for (const g of specialtyRows(input.doctors.map((d) => d.specialty ?? ''))) {
    const formula =
      g.label === NO_SPECIALTY
        ? `COUNTIFS(${range(cols.fullName)},"<>",${range(cols.specialty)},"")`
        : g.spellings.length === 1
          ? `COUNTIF(${range(cols.specialty)},${criterion(g.spellings[0])})`
          : `SUM(COUNTIF(${range(cols.specialty)},{${g.spellings.map(criterion).join(',')}}))`;
    byLabel.set(g.label, rows.length);
    line(g.label, formula, g.count);
  }
  line('Всего врачей', `COUNTA(${range(cols.fullName)})`, input.doctors.length);

  if (input.pharmacies) {
    const p = input.pharmacies;
    const ref = (col: string) =>
      `'${p.sheet.replace(/'/g, "''")}'!$${col}$${p.first}:$${col}$${p.last}`;
    const place = ref(p.place);
    // разных аптек: название + адрес (у сети одно название на много адресов)
    const formula = p.address
      ? `SUMPRODUCT((${place}<>"")/COUNTIFS(${place},${place}&"",${ref(p.address)},${ref(p.address)}&""))`
      : `SUMPRODUCT((${place}<>"")/COUNTIF(${place},${place}&""))`;
    rows.push([{ kind: 'label' }, { kind: 'label' }]);
    byLabel.set('Аптек', rows.length);
    line('Аптек', formula, p.count);
  }

  if (cols.potential) {
    rows.push([{ kind: 'label' }, { kind: 'label' }]);
    title('Потенциал', 'Врачей');
    for (const p of ['Высокий', 'Средний', 'Низкий']) {
      const n = input.doctors.filter(
        (d) => (d.potential ?? '').toLowerCase() === p.toLowerCase(),
      ).length;
      line(p, `COUNTIF(${range(cols.potential)},"${p}")`, n);
    }
    const none = input.doctors.filter((d) => !d.potential?.trim()).length;
    line(
      'Не указан',
      `COUNTIFS(${range(cols.fullName)},"<>",${range(cols.potential)},"")`,
      none,
    );
  }
  return { rows, byLabel };
}
