import type { Queue } from 'bullmq';

// Jest (CommonJS) не подключает ESM-пакет bullmq; сервису от @nestjs/bullmq
// нужен только декоратор внедрения очереди — подменяем его пустым
jest.mock('@nestjs/bullmq', () => ({ InjectQueue: () => () => undefined }));

import type { DirectoryService } from '../directory/directory.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { TemplatesService } from './templates.service';

/**
 * Импорт строк шаблона: в очередь, если она есть и Redis доступен, иначе —
 * сразу в запросе (как раньше). Проверяем выбор пути без настоящей базы.
 */
const counts = { created: 2, linked: 1 };

function service(opts: { queue?: Partial<Queue>; redisReady?: boolean }) {
  // импорт «в запросе»: транзакция возвращает результат importRows
  const transaction = jest.fn(() => Promise.resolve(counts));
  const prisma = { $transaction: transaction } as unknown as PrismaService;
  const s = new TemplatesService(
    prisma,
    {} as DirectoryService,
    opts.queue as Queue | undefined,
    { ready: opts.redisReady ?? false } as RedisService,
  );
  const start = (
    s as unknown as {
      startImport: (u: string, m: string, f: []) => Promise<unknown>;
    }
  ).startImport.bind(s);
  return { transaction, start: () => start('u1', '2026-10', []) };
}

/** Очередь-заглушка и её add — отдельно, чтобы проверять вызовы. */
function queue(impl: () => Promise<unknown>) {
  const add = jest.fn(impl);
  const q = { add, on: jest.fn(), getJob: jest.fn() } as Partial<Queue>;
  return { q, add };
}

describe('импорт шаблона: очередь или сразу', () => {
  it('очередь есть, Redis доступен — ставим задачу, в запросе не импортируем', async () => {
    const { q, add } = queue(() => Promise.resolve({ id: '42' }));
    const { transaction, start } = service({ queue: q, redisReady: true });
    await expect(start()).resolves.toEqual({ status: 'queued', jobId: '42' });
    expect(add).toHaveBeenCalledWith(
      'import',
      { userId: 'u1', month: '2026-10' },
      expect.objectContaining({ attempts: 3 }),
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('очереди нет (Redis не настроен) — импорт сразу', async () => {
    const { transaction, start } = service({});
    await expect(start()).resolves.toEqual({ status: 'done', ...counts });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('Redis заведомо недоступен — не ждём очередь, импорт сразу', async () => {
    const { q, add } = queue(() => new Promise(() => {})); // зависла бы навсегда
    const { start } = service({ queue: q, redisReady: false });
    await expect(start()).resolves.toEqual({ status: 'done', ...counts });
    expect(add).not.toHaveBeenCalled();
  });

  it('очередь ответила ошибкой — импорт сразу', async () => {
    const { q } = queue(() =>
      Promise.reject(new Error('Connection is closed')),
    );
    const { start } = service({ queue: q, redisReady: true });
    await expect(start()).resolves.toEqual({ status: 'done', ...counts });
  });

  it('очередь не ответила за 2 с — импорт сразу', async () => {
    jest.useFakeTimers();
    const { q } = queue(() => new Promise(() => {}));
    const { start } = service({ queue: q, redisReady: true });
    const result = start();
    await jest.advanceTimersByTimeAsync(2_100);
    await expect(result).resolves.toEqual({ status: 'done', ...counts });
    jest.useRealTimers();
  });

  it('статус чужой задачи не отдаём', async () => {
    const q = {
      on: jest.fn(),
      getJob: jest.fn(() =>
        Promise.resolve({ data: { userId: 'other' }, getState: jest.fn() }),
      ),
    } as unknown as Partial<Queue>;
    const s = new TemplatesService(
      {} as PrismaService,
      {} as DirectoryService,
      q as Queue,
      { ready: true } as RedisService,
    );
    await expect(s.importStatus('u1', '7')).rejects.toThrow('не найдена');
  });
});
