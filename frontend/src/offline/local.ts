// Чтение из памяти телефона — экраны работают одинаково с сетью и без неё.
import type { Me, Potential, VisitKind } from '../api/types';
import { addressMatch } from '../placeMatch';
import { db, kvDelete, kvGet, kvSet, type LocalVisit } from './db';

/** Визиты дня: строки из файла по порядку, затем введённые — по времени. */
export async function getDayVisits(userId: string, date: string) {
  const all = await (
    await db()
  ).getAllFromIndex('visits', 'by-user-date', [userId, date]);
  return all
    .filter((v) => !v.deleted)
    .sort(
      (a, b) =>
        (a.templateRow ?? Infinity) - (b.templateRow ?? Infinity) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

/** Все визиты месяца из памяти телефона (поиск по месяцу). */
export async function getMonthVisits(userId: string, month: string) {
  const all = await (
    await db()
  ).getAllFromIndex('visits', 'by-user-month', [userId, month]);
  return all.filter((v) => !v.deleted);
}

/** Визиты по clientId — чтобы показать найденное сервером в свежем виде с телефона. */
export async function getVisitsById(clientIds: string[]) {
  const d = await db();
  return Promise.all(clientIds.map((id) => d.get('visits', id)));
}

export async function getVisit(
  clientId: string,
): Promise<LocalVisit | undefined> {
  const v = await (await db()).get('visits', clientId);
  return v && !v.deleted ? v : undefined;
}

// ─── справочник ─────────────────────────────────────────────────────────────

export interface DirPlace {
  id: string;
  kind: 'CLINIC' | 'PHARMACY';
  name: string;
  address: string | null;
  /** аптека: последняя договорённость и дата визита, когда договорились */
  lastAgreement?: string | null;
  lastAgreementDate?: string | null;
}

export interface DirContact {
  id: string;
  fullName: string;
  specialty: string | null;
  phone: string | null;
  placeId: string | null;
  /** последняя договорённость с врачом и дата визита, когда договорились */
  lastAgreement?: string | null;
  lastAgreementDate?: string | null;
  potential?: Potential | null;
  place?: DirPlace;
}

interface Directory {
  places: DirPlace[];
  contacts: DirContact[];
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim();

async function directory(userId: string): Promise<Directory> {
  return (
    (await kvGet<Directory>(`directory:${userId}`)) ?? {
      places: [],
      contacts: [],
    }
  );
}

/** Подсказки по ФИО — из справочника на телефоне, без сети тоже. */
export async function searchContacts(userId: string, q: string, limit = 20) {
  const { places, contacts } = await directory(userId);
  const byId = new Map(places.map((p) => [p.id, p]));
  const query = norm(q);
  return contacts
    .filter((c) => norm(c.fullName).includes(query))
    .slice(0, limit)
    .map((c) => ({ ...c, place: c.placeId ? byId.get(c.placeId) : undefined }));
}

export async function searchPlaces(
  userId: string,
  kind: VisitKind,
  q: string,
  limit = 20,
) {
  const placeKind = kind === 'PHARMACY' ? 'PHARMACY' : 'CLINIC';
  const query = norm(q);
  return (await directory(userId)).places
    .filter((p) => p.kind === placeKind && norm(p.name).includes(query))
    .slice(0, limit);
}

/** Место по точному названию (без учёта регистра) — для договорённости аптеки. */
/**
 * Место по названию и адресу: у сети аптек одно название на много адресов.
 * Адрес не указан — первое с таким названием; указан — то, чей адрес совпал
 * (точно — раньше, чем «у места адреса нет»).
 */
export async function findPlace(
  userId: string,
  kind: VisitKind,
  name: string,
  address?: string,
) {
  const placeKind = kind === 'PHARMACY' ? 'PHARMACY' : 'CLINIC';
  const query = norm(name);
  if (!query) return undefined;
  const same = (await directory(userId)).places.filter(
    (p) => p.kind === placeKind && norm(p.name) === query,
  );
  if (!address?.trim()) return same[0];
  return same
    .map((p) => ({ p, score: addressMatch(address, p.address) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.p;
}

// ─── профиль — чтобы без сети не выкидывало на экран входа ─────────────────

export const getCachedMe = () => kvGet<Me>('me');
export const setCachedMe = (me: Me) => kvSet('me', me);
export const clearCachedMe = () => kvDelete('me');

/**
 * Просим браузер не стирать наши данные при нехватке места.
 * Для установленного PWA Chrome обычно соглашается.
 */
export async function requestPersistentStorage() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
