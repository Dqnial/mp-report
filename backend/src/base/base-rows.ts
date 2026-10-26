// Справочник → строки базы. Один человек — одна строка: справочник заводит
// врача по точному ФИО, поэтому одного и того же врача, записанного по-разному
// («Иванова Анна» и «Иванова Анна Сергеевна», опечатка в отчестве), здесь
// сводим вместе. Руководитель подсвечивает повторы ФИО в файле — их быть не должно.
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
  visits: { kind: 'DOCTOR' | 'PHARMACY'; products: unknown }[];
}

export interface DirectoryPlace {
  name: string;
  address: string | null;
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
    phone: firstOf(group, (c) => c.phone),
    place: withPlace?.place?.name.trim() ?? '',
    address: withPlace?.place?.address?.trim() ?? '',
    products: productsOf(group),
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
 * contacts — новые (по последнему визиту) первыми: при слиянии их данные
 * главнее. emptyPharmacies — аптеки без единого провизора: строкой без ФИО.
 * Врачи — по ЛПУ, затем по ФИО; аптеки — по названию, адресу, ФИО.
 */
export function buildBaseRows(
  contacts: DirectoryContact[],
  emptyPharmacies: DirectoryPlace[],
): BaseRows {
  const named = contacts.filter((c) => c.fullName.trim());
  const doctorGroups = groupPeople(
    named.filter((c) => !isPharmacist(c)),
    samePerson,
  );
  // провизор — тот же, если то же имя в той же аптеке
  const pharmacistGroups = groupPeople(
    named.filter(isPharmacist),
    (a, b) =>
      normName(a.fullName) === normName(b.fullName) &&
      normText(a.place?.name) === normText(b.place?.name) &&
      normText(a.place?.address) === normText(b.place?.address),
  );

  const doctors = doctorGroups.map(merge).sort(byKeys('place', 'fullName'));
  const pharmacies = [
    ...pharmacistGroups.map(merge),
    ...emptyPharmacies.map((p) => ({
      place: p.name.trim(),
      address: p.address?.trim() ?? '',
    })),
  ].sort(byKeys('place', 'address', 'fullName'));

  const merged = named.length - doctorGroups.length - pharmacistGroups.length;
  return { doctors, pharmacies, merged };
}
