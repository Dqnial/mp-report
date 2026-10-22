/** Склонение по числу: plural(1, ['визит', 'визита', 'визитов']) → «визит». */
export function plural(n: number, [one, few, many]: [string, string, string]) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

/** «1 неотправленное изменение», «3 неотправленных изменения» */
export const unsentChanges = (n: number) =>
  `${n} ${plural(n, ['неотправленное изменение', 'неотправленных изменения', 'неотправленных изменений'])}`;
