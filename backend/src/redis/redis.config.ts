// Redis необязателен: без REDIS_URL приложение работает как раньше — импорт
// шаблона идёт сразу в запросе, лимит входа считается в памяти процесса, кеша
// отчёта нет. Читаем переменную окружения напрямую: от неё зависит, какие
// модули подключать, а это решается до старта ConfigModule (см. main.ts).

export const redisUrl = () => process.env.REDIS_URL?.trim() ?? '';

export const redisEnabled = () => redisUrl() !== '';

/** Подключение для BullMQ: host/port/пароль/номер базы из REDIS_URL. */
export function bullConnection() {
  const u = new URL(redisUrl());
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: Number(u.pathname.slice(1) || 0),
    // воркер ждёт задачи блокирующими командами — повторы по одной команде ему не нужны
    maxRetriesPerRequest: null,
  };
}
