// Обёртка над fetch. Авторизация — httpOnly-куки, токенов в JS нет.
// Access живёт 15 минут: на 401 один раз обновляем сессию и повторяем запрос.

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Сессия закончилась (refresh не помог) — нужно войти заново. */
export class UnauthorizedError extends ApiError {
  constructor() {
    super(401, 'Нужно войти заново');
  }
}

// Один refresh на всех: refresh-токен одноразовый (ротация), и два
// параллельных обновления сервер принял бы за кражу и разлогинил все устройства.
let refreshing: Promise<boolean> | null = null;

function refreshSession() {
  refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function errorMessage(res: Response) {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    const m = body.message;
    if (Array.isArray(m)) return m.join('\n');
    if (m) return m;
  } catch {
    // не JSON
  }
  return res.status >= 500
    ? 'Сервер недоступен, попробуйте позже'
    : `Ошибка ${res.status}`;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const send = () =>
    fetch(`/api${path}`, { ...init, credentials: 'same-origin' });

  let res = await send();
  // у входа/выхода 401 — это ответ по существу («неверный пароль»), не протухшая сессия
  const isAuthCall = /^\/auth\/(login|register|refresh|logout)\b/.test(path);
  if (res.status === 401 && !isAuthCall) {
    if (!(await refreshSession())) throw new UnauthorizedError();
    res = await send();
    if (res.status === 401) throw new UnauthorizedError();
  }
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return res;
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const withBody = (method: string, body?: unknown): RequestInit =>
  body instanceof FormData
    ? { method, body }
    : {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      };

export const api = {
  get: <T>(path: string) => apiFetch(path).then((r) => json<T>(r)),
  post: <T>(path: string, body?: unknown) =>
    apiFetch(path, withBody('POST', body)).then((r) => json<T>(r)),
  put: <T>(path: string, body: unknown) =>
    apiFetch(path, withBody('PUT', body)).then((r) => json<T>(r)),
  patch: <T>(path: string, body: unknown) =>
    apiFetch(path, withBody('PATCH', body)).then((r) => json<T>(r)),
  delete: (path: string) => apiFetch(path, { method: 'DELETE' }).then(() => {}),
};
