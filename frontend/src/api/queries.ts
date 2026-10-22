import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { useSyncExternalStore } from 'react';
import {
  kvGet,
  kvSet,
  type LocalVisit,
  type VisitPayload,
} from '../offline/db';
import {
  clearCachedMe,
  getCachedMe,
  getDayVisits,
  getMonthVisits,
  getVisit,
  getVisitsById,
  searchContacts,
  searchPlaces,
  setCachedMe,
} from '../offline/local';
import {
  deleteVisit,
  fromServer,
  pullMonth,
  queueTemplate,
  refreshDirectory,
  saveVisit,
  waitForImport,
  stopSync,
  syncStatus,
  type ServerVisit,
} from '../offline/sync';
import { api, ApiError, apiFetch, UnauthorizedError } from './client';
import type {
  DayPlan,
  DayPreview,
  ReportFile,
  ImportCounts,
  Invite,
  Me,
  ReportCheck,
  TemplateSummary,
  TemplateUploaded,
  VisitKind,
} from './types';

export const keys = {
  me: ['me'] as const,
  // 'local' — данные из памяти телефона; перечитываются при любой правке
  local: ['local'] as const,
  day: (uid: string, date: string) => ['local', 'day', uid, date] as const,
  month: (uid: string, month: string) =>
    ['local', 'month', uid, month] as const,
  search: (uid: string, q: string) => ['local', 'search', uid, q] as const,
  visit: (clientId: string) => ['local', 'visit', clientId] as const,
  contacts: (uid: string, q: string) => ['local', 'contacts', uid, q] as const,
  places: (uid: string, kind: VisitKind, q: string) =>
    ['local', 'places', uid, kind, q] as const,
  plan: (date: string) => ['plan', date] as const,
  templates: ['templates'] as const,
  report: (month: string) => ['report', month] as const,
  // под ключом отчёта месяца — сбрасывается вместе с ним
  preview: (date: string) =>
    ['report', date.slice(0, 7), 'preview', date] as const,
  invites: ['invites'] as const,
};

/** Нет связи с сервером (а не ответ сервера с ошибкой). */
const isNetworkError = (e: unknown) => !(e instanceof ApiError);

// ─── вход ───────────────────────────────────────────────────────────────────

/**
 * null — не вошёл. Без сети берём последний известный профиль:
 * медпред в подвале поликлиники не должен оказаться на экране входа.
 */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        const me = await api.get<Me>('/auth/me');
        await setCachedMe(me);
        return me;
      } catch (e) {
        if (e instanceof UnauthorizedError) {
          await clearCachedMe();
          return null;
        }
        if (isNetworkError(e)) return (await getCachedMe()) ?? null;
        throw e;
      }
    },
    staleTime: Infinity,
  });
}

/** userId текущего пользователя (страницы за входом — он там всегда есть). */
export const useUserId = () => useMe().data?.id ?? '';

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { login: string; password: string }) =>
      api.post('/auth/login', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      token: string;
      login: string;
      password: string;
      fullName: string;
    }) => api.post('/auth/register', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}

/**
 * Выход. Неотправленная очередь не удаляется: она привязана к пользователю
 * и уйдёт, когда он снова войдёт на этом телефоне.
 */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: async () => {
      stopSync();
      await clearCachedMe();
      // сначала «не вошёл» — приложение сразу переключается на экран входа;
      // потом чистим остальное. Наоборот (clear → set) экраны успевали
      // перерисоваться без профиля и падали, выход «зависал».
      qc.setQueryData(keys.me, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
    },
  });
}

// ─── синхронизация ──────────────────────────────────────────────────────────

export const useSyncStatus = () =>
  useSyncExternalStore(syncStatus.subscribe, syncStatus.get);

// ─── визиты (память телефона) ───────────────────────────────────────────────

export function useDayVisits(date: string) {
  const uid = useUserId();
  return useQuery({
    queryKey: keys.day(uid, date),
    queryFn: () => getDayVisits(uid, date),
    enabled: !!uid,
    placeholderData: keepPreviousData,
  });
}

/** Визиты месяца из памяти телефона — поиск по месяцу работает и без сети. */
export function useMonthVisits(month: string, enabled: boolean) {
  const uid = useUserId();
  return useQuery({
    queryKey: keys.month(uid, month),
    queryFn: () => getMonthVisits(uid, month),
    enabled: !!uid && enabled,
    placeholderData: keepPreviousData,
  });
}

/**
 * Поиск по всем месяцам — на сервере (на телефоне лежат не все месяцы).
 * Найденное, что есть на телефоне, показываем в телефонном виде: там могут
 * быть ещё не отправленные правки; удалённые на телефоне — скрываем.
 */
export function useServerSearch(q: string, enabled: boolean) {
  const uid = useUserId();
  return useQuery({
    queryKey: keys.search(uid, q),
    queryFn: async () => {
      const res = await api.get<{ visits: ServerVisit[]; truncated: boolean }>(
        `/visits/search?q=${encodeURIComponent(q)}`,
      );
      const local = await getVisitsById(res.visits.map((v) => v.clientId));
      const visits = res.visits.flatMap((v, i) => {
        const mine = local[i];
        if (mine?.deleted) return [];
        return [mine ?? fromServer(v, uid)];
      });
      return { visits, truncated: res.truncated };
    },
    enabled: !!uid && enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export const useVisit = (clientId: string | undefined) =>
  useQuery({
    queryKey: keys.visit(clientId ?? ''),
    queryFn: async () => (await getVisit(clientId!)) ?? null,
    enabled: !!clientId,
  });

/** Сохранение мгновенное (память телефона), отправка — в фоне. */
export const useSaveVisit = () =>
  useMutation({
    mutationFn: (v: {
      clientId: string;
      payload: VisitPayload;
      existing?: LocalVisit;
    }) => saveVisit(v.clientId, v.payload, v.existing),
  });

/**
 * Ошибку показываем здесь, а не в месте вызова: экран визита к этому моменту
 * уже закрыт (сразу уходим к списку), а его колбэки после ухода не вызываются.
 */
export const useDeleteVisit = () =>
  useMutation({
    mutationFn: (v: LocalVisit) => deleteVisit(v),
    onError: (e) =>
      notifications.show({
        color: 'red',
        title: 'Не удалось удалить визит',
        message: e.message,
      }),
  });

/** План дня — с сервера; без сети показываем последний известный. */
export function usePlan(date: string) {
  const uid = useUserId();
  return useQuery({
    queryKey: keys.plan(date),
    queryFn: async () => {
      const cacheKey = `plan:${uid}:${date}`;
      try {
        const plan = await api.get<DayPlan>(`/plan?date=${date}`);
        await kvSet(cacheKey, plan);
        return { ...plan, stale: false };
      } catch (e) {
        const cached = isNetworkError(e) && (await kvGet<DayPlan>(cacheKey));
        if (cached) return { ...cached, stale: true };
        throw e;
      }
    },
    enabled: !!uid,
    placeholderData: keepPreviousData,
  });
}

// ─── справочник (память телефона) ───────────────────────────────────────────

export function useContacts(q: string) {
  const uid = useUserId();
  return useQuery({
    queryKey: keys.contacts(uid, q),
    queryFn: () => searchContacts(uid, q),
    enabled: !!uid && q.trim().length >= 2,
    placeholderData: keepPreviousData,
  });
}

export function usePlaces(kind: VisitKind, q: string) {
  const uid = useUserId();
  return useQuery({
    queryKey: keys.places(uid, kind, q),
    queryFn: () => searchPlaces(uid, kind, q),
    enabled: !!uid,
    placeholderData: keepPreviousData,
  });
}

// ─── шаблон и отчёт (нужен сервер) ──────────────────────────────────────────

export const useTemplates = () =>
  useQuery({
    queryKey: keys.templates,
    queryFn: () => api.get<TemplateSummary[]>('/templates'),
  });

/** Без сети шаблон ждёт в памяти телефона и загрузится сам. */
export function useUploadTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      file: File,
    ): Promise<
      | { queued: true }
      | ({ queued: false; importPending: boolean } & TemplateUploaded & {
            imported: ImportCounts;
          })
    > => {
      const fd = new FormData();
      fd.append('file', file, file.name);
      try {
        const uploaded = await api.post<TemplateUploaded>('/templates', fd);
        // строки файла сервер читает фоновой задачей — дожидаемся её и сразу
        // забираем визиты на телефон, а не при следующей фоновой подгрузке
        const imported = await waitForImport(uploaded);
        await Promise.all([pullMonth(uploaded.month), refreshDirectory()]);
        return {
          queued: false,
          ...uploaded,
          imported: imported ?? { created: 0, linked: 0 },
          importPending: imported === null,
        };
      } catch (e) {
        if (!isNetworkError(e)) throw e;
        await queueTemplate(file);
        return { queued: true };
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.templates });
      void qc.invalidateQueries({ queryKey: ['plan'] });
      void invalidateReportChecks(qc);
    },
  });
}

/**
 * Сбросить проверки отчёта, но не скачанные файлы: файл хранится под версией,
 * и если данные изменились, проверка вернёт новую версию — новый ключ, файл
 * скачается сам. Сброс файла заставил бы качать его заново при каждой
 * фоновой синхронизации, даже когда ничего не менялось.
 */
export const invalidateReportChecks = (qc: QueryClient) =>
  qc.invalidateQueries({
    queryKey: ['report'],
    predicate: (q) => q.queryKey[2] !== 'file',
  });

export const useReportCheck = (month: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.report(month),
    queryFn: () => api.get<ReportCheck>(`/reports/${month}/check`),
    enabled,
    // перед отправкой — всегда свежая проверка
    staleTime: 0,
  });

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Готовый файл отчёта, скачанный заранее. navigator.share нужно вызывать сразу
 * по нажатию — если сначала ждать сеть, браузер отвечает «Permission denied».
 * Ключ вложен в report(month): правка визита сбрасывает и проверку, и файл.
 */
/** Строки дня как в готовом файле. Считает сервер — тем же кодом, что и отчёт. */
export const usePreview = (date: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.preview(date),
    queryFn: () =>
      api.get<DayPreview>(`/reports/preview?date=${encodeURIComponent(date)}`),
    enabled,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

/**
 * Готовый файл отчёта — по версии из проверки. Файл одной версии не меняется,
 * поэтому повторный заход на экран его не скачивает; новая версия (визиты
 * изменились) — новый ключ, файл скачивается один раз. Старый файл под новой
 * версией не показываем (без placeholderData).
 */
export const useReportFile = (
  month: string,
  fileName: string | undefined,
  version: string | null | undefined,
) =>
  useQuery({
    queryKey: [...keys.report(month), 'file', fileName, version],
    queryFn: async (): Promise<ReportFile> => {
      const res = await apiFetch(`/reports/${month}`);
      return {
        file: new File([await res.blob()], fileName!, { type: XLSX_MIME }),
        version: res.headers.get('X-Report-Version'),
      };
    },
    enabled: !!fileName && version !== undefined,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });

// ─── приглашения ────────────────────────────────────────────────────────────

export const useInvites = (enabled: boolean) =>
  useQuery({
    queryKey: keys.invites,
    queryFn: () => api.get<Invite[]>('/invites'),
    enabled,
  });

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Invite>('/invites'),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invites }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/invites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invites }),
  });
}
