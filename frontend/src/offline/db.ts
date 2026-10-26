// Память телефона (IndexedDB). Главное правило офлайна: визит сначала
// записывается сюда, и только потом уходит на сервер; из очереди отправки
// запись удаляется лишь после ответа сервера «принял».
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Potential, VisitKind, VisitProduct } from '../api/types';

export type SyncState = 'synced' | 'pending' | 'error';

/** Визит в памяти телефона. Ключ — clientId (его придумывает телефон). */
export interface LocalVisit {
  clientId: string;
  userId: string;
  /** id на сервере — есть только у дошедших визитов */
  id?: string;
  date: string; // YYYY-MM-DD
  month: string; // YYYY-MM — для выборки месяца
  kind: VisitKind;
  placeName: string | null;
  address: string | null;
  fullName: string | null;
  specialty: string | null;
  phone: string | null;
  products: VisitProduct[];
  productsRaw: string | null;
  comment: string | null;
  /** врач: договорённость, факт выполнения, отклонение */
  agreement: string | null;
  fact: string | null;
  deviation: string | null;
  /** врач: потенциал (у визитов, сохранённых до появления поля, — нет) */
  potential?: Potential | null;
  templateRow: number | null;
  fromFile: boolean;
  createdAt: string;
  /** время последней правки на устройстве — для «последняя правка побеждает» */
  updatedAt: string;
  syncState: SyncState;
  syncError?: string;
  /** удалён на телефоне, удаление ещё не дошло до сервера — в списках не показываем */
  deleted?: boolean;
}

export type VisitPayload = Pick<
  LocalVisit,
  | 'date'
  | 'kind'
  | 'placeName'
  | 'address'
  | 'fullName'
  | 'specialty'
  | 'phone'
  | 'products'
  | 'comment'
  | 'agreement'
  | 'fact'
  | 'deviation'
  | 'potential'
>;

/** Операция в очереди отправки. Выполняются строго по порядку. */
export type OutboxOp =
  | {
      key?: number;
      type: 'put';
      userId: string;
      clientId: string;
      updatedAt: string;
      payload: VisitPayload;
      error?: string;
    }
  | {
      key?: number;
      type: 'delete';
      userId: string;
      clientId: string;
      updatedAt: string;
      error?: string;
    }
  | {
      key?: number;
      type: 'template';
      userId: string;
      clientId: string; // имя файла — чтобы показать в интерфейсе
      updatedAt: string;
      file: Blob;
      fileName: string;
      error?: string;
    };

interface MpDB extends DBSchema {
  visits: {
    key: string;
    value: LocalVisit;
    indexes: { 'by-user-date': [string, string]; 'by-user-month': [string, string] };
  };
  outbox: {
    key: number;
    value: OutboxOp;
    indexes: { 'by-user': string };
  };
  /** справочник, план дня, профиль и прочее «последнее известное» */
  kv: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<MpDB>> | null = null;

export function db() {
  dbPromise ??= openDB<MpDB>('mp-report', 1, {
    upgrade(d) {
      const visits = d.createObjectStore('visits', { keyPath: 'clientId' });
      visits.createIndex('by-user-date', ['userId', 'date']);
      visits.createIndex('by-user-month', ['userId', 'month']);
      const outbox = d.createObjectStore('outbox', {
        keyPath: 'key',
        autoIncrement: true,
      });
      outbox.createIndex('by-user', 'userId');
      d.createObjectStore('kv');
    },
  });
  return dbPromise;
}

export async function kvGet<T>(key: string) {
  return (await (await db()).get('kv', key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown) {
  await (await db()).put('kv', value, key);
}

export async function kvDelete(key: string) {
  await (await db()).delete('kv', key);
}
