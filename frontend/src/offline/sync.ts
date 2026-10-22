// Синхронизация визитов телефон ↔ сервер.
//
// Отправка («push»): все изменения ложатся в очередь (outbox) и уходят строго
// по порядку. Операция удаляется из очереди только после ответа сервера.
// Повтор безопасен: визит адресуется clientId, сервер не создаст дубль, а
// из двух правок побеждает более поздняя (по времени на устройстве).
//
// Получение («pull»): месяц целиком с сервера — так до телефона доходят
// правки и удаления с других устройств. Визиты с неотправленными
// изменениями при этом не трогаем — местная версия главнее, пока не уйдёт.
import { api, ApiError, apiFetch, UnauthorizedError } from '../api/client';
import type { TemplateUploaded, Visit } from '../api/types';
import { monthOf, todayIso } from '../dates';
import {
  db,
  kvSet,
  type LocalVisit,
  type OutboxOp,
  type VisitPayload,
} from './db';

// ─── состояние для интерфейса ───────────────────────────────────────────────

export interface SyncStatus {
  /** операций в очереди (визиты и шаблоны) */
  pending: number;
  /** из них сервер отверг — нужен человек */
  errors: number;
  syncing: boolean;
  /** последняя попытка не дошла до сервера */
  offline: boolean;
  /** сессия кончилась — после входа отправка продолжится */
  authRequired: boolean;
  /** месяцы, которые сейчас подгружаются с сервера */
  pulling: string[];
  /** месяцы, уже подгруженные с сервера за этот запуск приложения */
  pulled: string[];
}

let status: SyncStatus = {
  pending: 0,
  errors: 0,
  syncing: false,
  offline: !navigator.onLine,
  authRequired: false,
  pulling: [],
  pulled: [],
};
const statusListeners = new Set<() => void>();

export const syncStatus = {
  get: () => status,
  subscribe(fn: () => void) {
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
  },
};

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((fn) => fn());
}

/** Данные в памяти телефона поменялись — экраны перечитывают. */
const changeListeners = new Set<(event: { serverChanged: boolean }) => void>();
export function onLocalChange(fn: (event: { serverChanged: boolean }) => void) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}
const notify = (serverChanged = false) =>
  changeListeners.forEach((fn) => fn({ serverChanged }));

// ─── пользователь и фоновые повторы ─────────────────────────────────────────

let userId: string | null = null;
let timers: number[] = [];

const onOnline = () => {
  setStatus({ offline: false });
  void syncNow();
};
const onVisible = () => {
  if (document.visibilityState === 'visible') void syncNow();
};

/** Запускается после входа. Очередь другого пользователя не трогаем. */
export function startSync(uid: string) {
  if (userId === uid) return;
  stopSync();
  userId = uid;
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  timers = [
    // пока есть неотправленное — пробуем каждые 30 секунд
    window.setInterval(() => status.pending && void pushOutbox(), 30_000),
    // правки с других устройств
    window.setInterval(() => void pullMonth(monthOf(todayIso())), 120_000),
  ];
  void refreshCounts().then(() => syncNow());
}

export function stopSync() {
  window.removeEventListener('online', onOnline);
  document.removeEventListener('visibilitychange', onVisible);
  timers.forEach((t) => clearInterval(t));
  timers = [];
  userId = null;
  inFlight.clear();
  setStatus({ pulling: [], pulled: [] });
}

/** Отправить очередь, затем подтянуть текущий месяц и справочник. */
export async function syncNow() {
  await pushOutbox();
  if (!status.offline && !status.authRequired) {
    await Promise.all([pullMonth(monthOf(todayIso())), refreshDirectory()]);
  }
}

async function refreshCounts() {
  if (!userId) return;
  const ops = await (await db()).getAllFromIndex('outbox', 'by-user', userId);
  setStatus({
    pending: ops.length,
    errors: ops.filter((o) => o.error).length,
  });
}

// ─── локальные изменения ────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();

/** Сохранить визит: сразу в память телефона, на сервер — в фоне. */
export async function saveVisit(
  clientId: string,
  payload: VisitPayload,
  existing?: LocalVisit,
) {
  if (!userId) throw new Error('Нужно войти');
  const updatedAt = nowIso();
  const local: LocalVisit = {
    clientId,
    userId,
    createdAt: existing?.createdAt ?? updatedAt,
    templateRow: null,
    fromFile: false,
    productsRaw: null,
    ...existing,
    ...payload,
    month: monthOf(payload.date),
    updatedAt,
    syncState: 'pending',
    syncError: undefined,
    deleted: false,
  };
  const tx = (await db()).transaction(['visits', 'outbox'], 'readwrite');
  await tx.objectStore('visits').put(local);
  await dropRejected(tx.objectStore('outbox'), userId, clientId);
  await tx
    .objectStore('outbox')
    .add({ type: 'put', userId, clientId, updatedAt, payload });
  await tx.done;
  await afterLocalChange();
  return local;
}

/**
 * Визит исправили после того, как сервер его отверг: новая версия полная,
 * старые отвергнутые операции больше не нужны (иначе бы она ждала за ними).
 */
async function dropRejected(
  outbox: {
    index(name: 'by-user'): { getAll(key: string): Promise<OutboxOp[]> };
    delete(key: number): Promise<void>;
  },
  uid: string,
  clientId: string,
) {
  for (const op of await outbox.index('by-user').getAll(uid)) {
    if (op.clientId === clientId && op.error) await outbox.delete(op.key!);
  }
}

/** Удалить визит: сразу скрыть на телефоне, удаление — в очередь. */
export async function deleteVisit(visit: LocalVisit) {
  if (!userId) throw new Error('Нужно войти');
  const updatedAt = nowIso();
  const tx = (await db()).transaction(['visits', 'outbox'], 'readwrite');
  await tx.objectStore('visits').put({
    ...visit,
    deleted: true,
    syncState: 'pending',
    updatedAt,
  });
  await dropRejected(tx.objectStore('outbox'), userId, visit.clientId);
  await tx.objectStore('outbox').add({
    type: 'delete',
    userId,
    clientId: visit.clientId,
    updatedAt,
  });
  await tx.done;
  await afterLocalChange();
}

/** Шаблон без сети: файл ждёт в памяти телефона и загрузится сам. */
export async function queueTemplate(file: File) {
  if (!userId) throw new Error('Нужно войти');
  await (
    await db()
  ).add('outbox', {
    type: 'template',
    userId,
    clientId: file.name,
    fileName: file.name,
    file,
    updatedAt: nowIso(),
  });
  await afterLocalChange();
}

/** Ошибка исправлена (или хотим попробовать ещё раз) — снять пометку. */
export async function retryFailed() {
  if (!userId) return;
  const d = await db();
  const ops = await d.getAllFromIndex('outbox', 'by-user', userId);
  for (const op of ops.filter((o) => o.error)) {
    await d.put('outbox', { ...op, error: undefined });
  }
  await afterLocalChange();
}

async function afterLocalChange() {
  await refreshCounts();
  notify();
  void pushOutbox();
}

// ─── отправка ───────────────────────────────────────────────────────────────

const isPermanent = (e: unknown) =>
  e instanceof ApiError &&
  !(e instanceof UnauthorizedError) &&
  e.status >= 400 &&
  e.status < 500 &&
  ![408, 429].includes(e.status);

export type ServerVisit = Visit & {
  deletedAt?: string | null;
  clientUpdatedAt?: string | null;
};

export function fromServer(v: ServerVisit, uid: string): LocalVisit {
  return {
    clientId: v.clientId,
    userId: uid,
    id: v.id,
    date: v.date,
    month: monthOf(v.date),
    kind: v.kind,
    placeName: v.placeName,
    address: v.address,
    fullName: v.fullName,
    specialty: v.specialty,
    phone: v.phone,
    products: v.products,
    productsRaw: v.productsRaw,
    comment: v.comment,
    agreement: v.agreement ?? null,
    fact: v.fact ?? null,
    deviation: v.deviation ?? null,
    templateRow: v.templateRow,
    fromFile: v.fromFile,
    createdAt: v.createdAt,
    updatedAt: v.clientUpdatedAt ?? v.createdAt,
    syncState: 'synced',
  };
}

async function send(op: OutboxOp) {
  const id = encodeURIComponent(op.clientId);
  if (op.type === 'put') {
    // пустые поля — не отправляем (на сервере это «очистить»)
    const body = Object.fromEntries(
      Object.entries({ ...op.payload, updatedAt: op.updatedAt }).filter(
        ([, v]) => v !== null && v !== undefined && v !== '',
      ),
    );
    return api.put<{ visit: ServerVisit; applied: boolean }>(
      `/visits/sync/${id}`,
      body,
    );
  }
  if (op.type === 'delete') {
    await apiFetch(
      `/visits/sync/${id}?updatedAt=${encodeURIComponent(op.updatedAt)}`,
      { method: 'DELETE' },
    );
    return null;
  }
  const fd = new FormData();
  fd.append('file', op.file, op.fileName);
  return api.post<TemplateUploaded>('/templates', fd);
}

/** Применить ответ сервера к памяти телефона, если новых правок нет. */
async function applyResult(op: OutboxOp, result: unknown) {
  if (op.type === 'template' || !userId) return;
  const d = await db();
  const later = (await d.getAllFromIndex('outbox', 'by-user', userId)).some(
    (o) => o.clientId === op.clientId && o.type !== 'template',
  );
  if (later) return; // впереди ещё правки этого визита — местная версия главнее

  if (op.type === 'delete') {
    await d.delete('visits', op.clientId);
    return;
  }
  const { visit } = result as { visit: ServerVisit };
  // сервер сказал «у меня новее» — и это удаление с другого устройства
  if (visit.deletedAt) await d.delete('visits', op.clientId);
  else await d.put('visits', fromServer(visit, userId));
}

let pushing: Promise<void> | null = null;
let pushAgain = false;

/** Отправить очередь. Параллельный вызов не запускает вторую отправку. */
export function pushOutbox(): Promise<void> {
  if (pushing) {
    pushAgain = true;
    return pushing;
  }
  pushing = (async () => {
    setStatus({ syncing: true });
    try {
      do {
        pushAgain = false;
        await pushOnce();
      } while (pushAgain && !status.offline && !status.authRequired);
    } finally {
      pushing = null;
      setStatus({ syncing: false });
      await refreshCounts();
    }
  })();
  return pushing;
}

async function pushOnce() {
  if (!userId) return;
  const uid = userId;
  const d = await db();
  const ops = await d.getAllFromIndex('outbox', 'by-user', uid);
  ops.sort((a, b) => a.key! - b.key!);

  // визит с отвергнутой операцией ждёт человека; его следующие правки — тоже
  const blocked = new Set(ops.filter((o) => o.error).map((o) => o.clientId));
  let changed = false;
  let sent = false;

  for (const op of ops) {
    if (op.error || blocked.has(op.clientId)) continue;
    try {
      const result = await send(op);
      await d.delete('outbox', op.key!);
      await applyResult(op, result);
      changed = true;
      sent = true;
      setStatus({ offline: false, authRequired: false });
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        setStatus({ authRequired: true });
        break;
      }
      if (!isPermanent(e)) {
        // нет сети или сервер недоступен — попробуем позже, порядок сохраняем
        setStatus({ offline: true });
        break;
      }
      // сервер отверг данные — не выбрасываем, помечаем для человека
      const message = (e as Error).message;
      await d.put('outbox', { ...op, error: message });
      blocked.add(op.clientId);
      if (op.type !== 'template') {
        const v = await d.get('visits', op.clientId);
        if (v)
          await d.put('visits', {
            ...v,
            syncState: 'error',
            syncError: message,
          });
      }
      changed = true;
    }
  }
  if (changed) notify(true);
  // сервер обновил справочник по этим визитам (контакты, договорённости) —
  // забираем, чтобы следующий визит к тому же врачу подставил свежее
  if (sent) void refreshDirectory();
}

// ─── получение ──────────────────────────────────────────────────────────────

const inFlight = new Map<string, Promise<void>>();

/**
 * Месяц с сервера: правки и удаления с других устройств доходят до телефона.
 * Пока идёт — месяц в status.pulling (экраны показывают «Загружаю…»).
 * Повторный вызов для того же месяца ждёт уже идущую загрузку.
 */
export function pullMonth(month: string): Promise<void> {
  if (!userId) return Promise.resolve();
  const running = inFlight.get(month);
  if (running) return running;
  const uid = userId;
  setStatus({ pulling: [...status.pulling, month] });
  const job = pullMonthOnce(uid, month)
    .then((ok) => {
      if (ok && !status.pulled.includes(month)) {
        setStatus({ pulled: [...status.pulled, month] });
      }
    })
    .finally(() => {
      inFlight.delete(month);
      setStatus({ pulling: status.pulling.filter((m) => m !== month) });
    });
  inFlight.set(month, job);
  return job;
}

/** Подгрузить месяц, если в этот запуск его ещё не брали (листание дней). */
export function ensureMonth(month: string) {
  if (status.pulled.includes(month)) return Promise.resolve();
  return pullMonth(month);
}

async function pullMonthOnce(uid: string, month: string): Promise<boolean> {
  let server: ServerVisit[];
  try {
    server = await api.get<ServerVisit[]>(`/visits?month=${month}`);
    setStatus({ offline: false });
  } catch (e) {
    if (e instanceof UnauthorizedError) setStatus({ authRequired: true });
    else if (!(e instanceof ApiError)) setStatus({ offline: true });
    return false;
  }
  const d = await db();
  const tx = d.transaction(['visits', 'outbox'], 'readwrite');
  const pendingIds = new Set(
    (await tx.objectStore('outbox').index('by-user').getAll(uid)).map(
      (o) => o.clientId,
    ),
  );
  const visits = tx.objectStore('visits');
  const local = await visits.index('by-user-month').getAll([uid, month]);
  const onServer = new Set(server.map((v) => v.clientId));

  for (const v of server) {
    if (!pendingIds.has(v.clientId)) await visits.put(fromServer(v, uid));
  }
  // нет на сервере и нечего отправлять — удалили на другом устройстве
  for (const v of local) {
    if (!onServer.has(v.clientId) && !pendingIds.has(v.clientId)) {
      await visits.delete(v.clientId);
    }
  }
  await tx.done;
  await kvSet(`pulled:${uid}:${month}`, Date.now());
  notify(true);
  return true;
}

// ─── справочник для подсказок без сети ──────────────────────────────────────

export async function refreshDirectory() {
  if (!userId) return;
  const uid = userId;
  try {
    const dir = await api.get<unknown>('/directory');
    await kvSet(`directory:${uid}`, dir);
    notify();
  } catch {
    // без сети — остаётся последний сохранённый
  }
}
