// Даты как строки YYYY-MM-DD в местном времени — так их ждёт сервер.

const pad = (n: number) => String(n).padStart(2, '0');

export const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayIso = () => toIsoDate(new Date());

const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function addDays(iso: string, days: number) {
  const d = parse(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** Следующий/предыдущий будний день — визиты только по будням. */
export function shiftWorkday(iso: string, dir: 1 | -1) {
  let next = addDays(iso, dir);
  while ([0, 6].includes(parse(next).getDay())) next = addDays(next, dir);
  return next;
}

/** «пятница, 9 октября» */
export const formatDay = (iso: string) =>
  parse(iso).toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

/** «октябрь 2026» */
export const formatMonth = (month: string) =>
  parse(`${month}-01`)
    .toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric',
    })
    .replace(' г.', '');

export const monthOf = (iso: string) => iso.slice(0, 7);
