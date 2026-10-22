// Врач или аптека для ЛПУ из плана. Колонке C («Врач»/«Аптека») в шаблоне
// верить нельзя (бывает «Фармленд Полевая» с меткой «Врач»), поэтому смотрим
// на то, что знаем сами, — в порядке надёжности:
//   1) это место уже есть в справочнике — тип из самого свежего визита туда;
//   2) сеть: первое слово названия встречается у известных мест
//      («Фармленд Лесная 19», «Фармленд Садовая» — аптеки ⇒ «Фармленд Полевая» тоже);
//   3) слова «аптека», «фарм», «pharm» в названии;
//   4) колонка C — последняя подсказка.
import type { PlaceKind, VisitKind } from '@prisma/client';
import { normPlace } from './xlsx-template';

export interface KnownPlace {
  name: string;
  kind: PlaceKind;
  updatedAt: Date;
}

/** Служебные слова в начале названия — не название сети. */
const NOT_A_CHAIN = new Set([
  'тоо',
  'ип',
  'ао',
  'кгп',
  'гкп',
  'гп',
  'на',
  'пхв',
  'мц',
  'медицинский',
  'городская',
  'городской',
  'центр',
  'клиника',
  'поликлиника',
  'аптека',
]);

/** Первое значимое слово названия: «ТОО Vita pharm» → «vita». */
export function chainToken(name: string) {
  return (
    normPlace(name)
      .split(' ')
      .find((w) => w.length >= 3 && !/^\d/.test(w) && !NOT_A_CHAIN.has(w)) ??
    null
  );
}

const toVisitKind = (k: PlaceKind): VisitKind =>
  k === 'PHARMACY' ? 'PHARMACY' : 'DOCTOR';

export function makePlaceKindGuesser(known: KnownPlace[]) {
  // 1) точное совпадение — самый свежий: если место записано и врачом, и
  //    аптекой, побеждает последнее исправление
  const byName = new Map<string, KnownPlace>();
  for (const p of known) {
    const key = normPlace(p.name);
    const prev = byName.get(key);
    if (!prev || prev.updatedAt < p.updatedAt) byName.set(key, p);
  }

  // 2) сети: сколько мест каждого типа начинаются с этого слова
  const chains = new Map<string, { pharmacy: number; clinic: number }>();
  for (const p of byName.values()) {
    const token = chainToken(p.name);
    if (!token) continue;
    const c = chains.get(token) ?? { pharmacy: 0, clinic: 0 };
    if (p.kind === 'PHARMACY') c.pharmacy++;
    else c.clinic++;
    chains.set(token, c);
  }
  const chainKind = (name: string): VisitKind | null => {
    const token = chainToken(name);
    if (!token) return null;
    // «Фармлендполевая садовая» (без пробела) — тоже «фармленд…»
    const stats =
      chains.get(token) ??
      [...chains].find(([t]) => t.length >= 4 && token.startsWith(t))?.[1];
    if (!stats || stats.pharmacy === stats.clinic) return null;
    return stats.pharmacy > stats.clinic ? 'PHARMACY' : 'DOCTOR';
  };

  return (place: string, label: string): VisitKind => {
    const exact = byName.get(normPlace(place));
    if (exact) return toVisitKind(exact.kind);
    const chain = chainKind(place);
    if (chain) return chain;
    if (/аптек|фарм|pharm/i.test(place)) return 'PHARMACY';
    return /^\s*аптек/i.test(label) ? 'PHARMACY' : 'DOCTOR';
  };
}
