import type { Logger } from '@nestjs/common';

/**
 * Обработчик ошибок подключения очереди/воркера к Redis. Без подписки BullMQ
 * печатает полный стек на каждую попытку переподключения — сотни строк в
 * минуту, пока Redis недоступен. Пишем коротко и не чаще раза в минуту.
 */
export function quietRedisErrors(logger: Logger, what: string) {
  let last = 0;
  return (e: Error) => {
    const now = Date.now();
    if (now - last < 60_000) return;
    last = now;
    const reason = e.message || (e as { code?: string }).code || 'нет связи';
    logger.warn(`${what}: Redis недоступен (${reason}), жду подключения`);
  };
}
