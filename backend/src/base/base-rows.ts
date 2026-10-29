// Справочник и визиты → строки базы.
//
// Врачи — из справочника. Один человек — одна строка: справочник заводит
// врача по точному ФИО, поэтому одного и того же врача, записанного по-разному
// («Иванова Анна» и «Иванова Анна Сергеевна», опечатка в отчестве), здесь
// сводим вместе. Руководитель подсвечивает повторы ФИО в файле — их быть не должно.
//
// Аптеки — из визитов: провизоров записывают по имени («Айгуль»), и справочник
// считает тёзок из разных аптек одним человеком с одной аптекой. Строка — каждая
// пара «аптека + провизор», которая была в визитах.
import { levenshtein, normPlace } from '../common/place-match';
import { PRODUCTS, productLabel } from '../products';
import type { BaseRecord } from './base-xlsx';

export interface DirectoryContact {
  fullName: string;
  specialty: string | null;
  phone: string | null;
  place: {
    kind: 'CLINIC' | 'PHARMACY';
    name: string;
    address: string | null;
  } | null;
  /** визиты к этому контакту, новые первыми */
  visits: {
    kind: 'DOCTOR' | 'PHARMACY';
    products: unknown;
    phone?: string | null;
  }[];
  potential?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
}

/** Как потенциал пишут в базе руководителя. */
export const POTENTIAL_LABEL = {
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
} as const;

/** Визит в аптеку: место — из визита, провизор — из справочника, если правили. */
export interface PharmacyVisit {
  placeName: string;
  address: string | null;
  fullName: string | null;
  specialty: string | null;
  phone: string | null;
}

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normText = (s?: string | null) => normPlace(s ?? '');

/**
 * Один ли это человек. Одинаковые фамилия и имя, а дальше:
 * отчество отличается на опечатку (до 2 букв) — да;
 * у одной записи отчества нет — да, если совпадает место или специальность
 * (иначе это могут быть тёзки из разных поликлиник).
 */
export function samePerson(a: DirectoryContact, b: DirectoryContact) {
  const x = normName(a.fullName).split(' ');
  const y = normName(b.fullName).split(' ');
  if (x.join(' ') === y.join(' ')) return true;
  if (x.length < 2 || y.length < 2) return false;
  if (x[0] !== y[0] || x[1] !== y[1]) return false;
  const rx = x.slice(2).join(' ');
  const ry = y.slice(2).join(' ');
  if (rx && ry) return levenshtein(rx, ry) <= 2;
  const samePlace =
    !!a.place && !!b.place && normText(a.place.name) === normText(b.place.name);
  const sameSpecialty =
    !!normText(a.specialty) && normText(a.specialty) === normText(b.specialty);
  return samePlace || sameSpecialty;
}

/** Препараты из визитов: чаще показанные — первыми. */
function productsOf(contacts: DirectoryContact[]) {
  const counts = new Map<string, number>();
  for (const c of contacts) {
    for (const v of c.visits) {
      const list = Array.isArray(v.products) ? v.products : [];
      for (const p of list as { code?: unknown }[]) {
        if (typeof p?.code === 'string') {
          counts.set(p.code, (counts.get(p.code) ?? 0) + 1);
        }
      }
    }
  }
  const order = (code: string) => {
    const i = PRODUCTS.findIndex((p) => p.code === code);
    return i < 0 ? PRODUCTS.length : i;
  };
  return [...counts.entries()]
    .sort(([a, n], [b, m]) => m - n || order(a) - order(b))
    .map(([code]) => productLabel(code))
    .join(', ');
}

const firstOf = (
  contacts: DirectoryContact[],
  pick: (c: DirectoryContact) => string | null | undefined,
) =>
  contacts
    .map(pick)
    .find((v) => v?.trim())
    ?.trim() ?? '';

/**
 * Телефон: из справочника; нет — как записано в визите (там бывает «телефон
 * не дала» — его и пишем, а не пустую ячейку: так видно, что не забыли).
 */
const phoneOf = (group: DirectoryContact[]) =>
  firstOf(group, (c) => c.phone) ||
  group
    .flatMap((c) => c.visits.map((v) => v.phone))
    .find((p) => p?.trim())
    ?.trim() ||
  '';

/** Склеить записи одного человека: свежие данные главнее, пустое — из старых. */
function merge(group: DirectoryContact[]): BaseRecord {
  // полное ФИО: из записи, где оно длиннее (с отчеством); при равенстве — свежее
  const fullName = group
    .reduce((best, c) =>
      normName(c.fullName).length > normName(best.fullName).length ? c : best,
    )
    .fullName.trim();
  const withPlace = group.find((c) => c.place);
  return {
    fullName,
    specialty: firstOf(group, (c) => c.specialty),
    phone: phoneOf(group),
    place: withPlace?.place?.name.trim() ?? '',
    address: withPlace?.place?.address?.trim() ?? '',
    products: productsOf(group),
    // у повторов — с самой свежей записи, где он отмечен
    potential: (() => {
      const p = group.find((c) => c.potential)?.potential;
      return p ? POTENTIAL_LABEL[p] : '';
    })(),
  };
}

/** Сгруппировать одного и того же человека (порядок — как во входе). */
function groupPeople(
  contacts: DirectoryContact[],
  same: (a: DirectoryContact, b: DirectoryContact) => boolean,
) {
  const groups: DirectoryContact[][] = [];
  for (const c of contacts) {
    const g = groups.find((list) => list.some((o) => same(o, c)));
    if (g) g.push(c);
    else groups.push([c]);
  }
  return groups;
}

const collator = new Intl.Collator('ru', {
  sensitivity: 'base',
  numeric: true,
});
const byKeys =
  (...fields: (keyof BaseRecord)[]) =>
  (a: BaseRecord, b: BaseRecord) => {
    for (const f of fields) {
      const d = collator.compare(a[f] ?? '', b[f] ?? '');
      if (d) return d;
    }
    return 0;
  };

/** Контакт без места — врач или провизор по последнему визиту. */
const isPharmacist = (c: DirectoryContact) =>
  c.place ? c.place.kind === 'PHARMACY' : c.visits[0]?.kind === 'PHARMACY';

export interface BaseRows {
  doctors: BaseRecord[];
  pharmacies: BaseRecord[];
  /** сколько записей справочника слилось с другими (повторы) */
  merged: number;
}

/**
 * Строки аптек из визитов (новые первыми): пара «аптека + провизор» — одна
 * строка; специальность и телефон — самые свежие из визитов в эту аптеку.
 * Аптека, где провизора ни разу не записали, — строкой без ФИО.
 */
export function pharmacyRows(visits: PharmacyVisit[]): BaseRecord[] {
  const placeKey = (v: PharmacyVisit) =>
    `${normText(v.placeName)}|${normText(v.address)}`;
  const groups = new Map<string, PharmacyVisit[]>();
  for (const v of visits) {
    if (!v.placeName.trim()) continue;
    const key = `${placeKey(v)}|${normName(v.fullName ?? '')}`;
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  const named = new Set(
    [...groups.values()]
      .filter((g) => g[0].fullName?.trim())
      .map((g) => placeKey(g[0])),
  );
  const latest = (
    g: PharmacyVisit[],
    pick: (v: PharmacyVisit) => string | null,
  ) =>
    g
      .map(pick)
      .find((x) => x?.trim())
      ?.trim() ?? '';
  return [...groups.values()]
    .filter((g) => g[0].fullName?.trim() || !named.has(placeKey(g[0])))
    .map((g) => ({
      fullName: g[0].fullName?.trim() ?? '',
      specialty: latest(g, (v) => v.specialty),
      phone: latest(g, (v) => v.phone),
      place: g[0].placeName.trim(),
      address: latest(g, (v) => v.address),
    }))
    .sort(byKeys('place', 'address', 'fullName'));
}

/**
 * contacts — новые (по последнему визиту) первыми: при слиянии их данные
 * главнее. pharmacyVisits — визиты в аптеки, новые первыми.
 * Врачи — по ЛПУ, затем по ФИО; аптеки — по названию, адресу, ФИО.
 */
export function buildBaseRows(
  contacts: DirectoryContact[],
  pharmacyVisits: PharmacyVisit[],
): BaseRows {
  const named = contacts.filter((c) => c.fullName.trim() && !isPharmacist(c));
  const doctorGroups = groupPeople(named, samePerson);
  const doctors = doctorGroups.map(merge).sort(byKeys('place', 'fullName'));
  return {
    doctors,
    pharmacies: pharmacyRows(pharmacyVisits),
    merged: named.length - doctorGroups.length,
  };
}
