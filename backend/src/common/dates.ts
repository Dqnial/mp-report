export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Date из колонки @db.Date (полночь UTC) → 'YYYY-MM-DD'. */
export const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

/** 'YYYY-MM-DD' → Date в полночь UTC — так Prisma пишет @db.Date. */
export const fromIsoDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Границы месяца 'YYYY-MM' для запроса по @db.Date: [from, to). */
export function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  return {
    from: new Date(Date.UTC(y, m - 1, 1)),
    to: new Date(Date.UTC(y, m, 1)),
  };
}

/** '2026-10-08' → '08.10' — для сообщений пользователю. */
export const shortRu = (iso: string) =>
  `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
