import { Transform } from 'class-transformer';

const mapString = (fn: (s: string) => string) =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? fn(value) : value,
  );

export const Trim = () => mapString((s) => s.trim());

/** Обрезает края и схлопывает повторные пробелы: «Иванова  А.С. » → «Иванова А.С.». */
export const Clean = () => mapString((s) => s.replace(/\s+/g, ' ').trim());

/** Логины храним в нижнем регистре: «Ivan» и «ivan» — один пользователь. */
export const NormalizeLogin = () => mapString((s) => s.trim().toLowerCase());
