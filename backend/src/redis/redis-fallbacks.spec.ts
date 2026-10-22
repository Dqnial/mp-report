import { ResilientThrottlerStorage } from '../auth/throttler-storage';
import { ReportCacheService } from '../report/report-cache.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from './redis.service';

/**
 * Главное правило Redis в проекте: его недоступность не ломает приложение.
 * Здесь — запасные режимы без настоящего Redis (подменяем клиент).
 */
const fakeRedis = (ready: boolean, client: object | null = {}) =>
  ({ ready, client }) as unknown as RedisService;

describe('ResilientThrottlerStorage', () => {
  it('Redis не настроен — считает попытки в памяти', async () => {
    const s = new ResilientThrottlerStorage(fakeRedis(false, null));
    const hits = [];
    for (let i = 0; i < 6; i++) {
      hits.push(await s.increment('ip', 60_000, 5, 300_000, 'auth'));
    }
    expect(hits.map((h) => h.totalHits)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(hits[5].isBlocked).toBe(true);
    s.onApplicationShutdown();
  });

  it('Redis упал посреди работы — тоже в памяти, без ошибки', async () => {
    const s = new ResilientThrottlerStorage(fakeRedis(true));
    // подменяем хранилище Redis на падающее
    (s as unknown as { redis: object }).redis = {
      increment: () => Promise.reject(new Error('Connection is closed')),
    };
    await expect(
      s.increment('ip', 60_000, 5, 0, 'auth'),
    ).resolves.toMatchObject({ totalHits: 1, isBlocked: false });
    s.onApplicationShutdown();
  });
});

describe('ReportCacheService', () => {
  const prisma = (count: number, maxUpdated: number | null) =>
    ({
      template: {
        findUnique: () =>
          Promise.resolve({ id: 'tpl', createdAt: new Date(1_000) }),
      },
      visit: {
        aggregate: () =>
          Promise.resolve({
            _count: { _all: count },
            _max: {
              updatedAt: maxUpdated == null ? null : new Date(maxUpdated),
            },
          }),
      },
    }) as unknown as PrismaService;

  it('ключ меняется при любой правке: новый визит, правка, удаление', async () => {
    const key = (count: number, updated: number | null) =>
      new ReportCacheService(prisma(count, updated), fakeRedis(true)).key(
        'u1',
        '2026-10',
      );
    const base = await key(10, 5_000);
    expect(await key(10, 5_000)).toBe(base); // ничего не менялось — тот же
    expect(await key(11, 6_000)).not.toBe(base); // новый визит
    expect(await key(10, 7_000)).not.toBe(base); // правка или мягкое удаление
    expect(base).toMatch(/^report:u1:2026-10:/);
  });

  it('Redis недоступен — нет кеша, но и нет ошибок', async () => {
    const cache = new ReportCacheService(prisma(1, 1), fakeRedis(false));
    await expect(cache.get('k')).resolves.toBeNull();
    await expect(
      cache.set('k', {
        file: Buffer.from('x'),
        placed: 1,
        warnings: [],
        total: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it('Redis отвечает ошибкой — тоже без кеша', async () => {
    const broken = fakeRedis(true, {
      get: () => Promise.reject(new Error('READONLY')),
      set: () => Promise.reject(new Error('OOM')),
    });
    const cache = new ReportCacheService(prisma(1, 1), broken);
    await expect(cache.get('k')).resolves.toBeNull();
    await expect(
      cache.set('k', {
        file: Buffer.from('x'),
        placed: 1,
        warnings: [],
        total: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it('файл переживает запись и чтение (base64)', async () => {
    const store = new Map<string, string>();
    const redis = fakeRedis(true, {
      get: (k: string) => Promise.resolve(store.get(k) ?? null),
      set: (k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve('OK');
      },
    });
    const cache = new ReportCacheService(prisma(1, 1), redis);
    const file = Buffer.from([0, 1, 2, 250, 255]);
    await cache.set('k', { file, placed: 3, warnings: ['w'], total: 4 });
    const back = await cache.get('k');
    expect(back?.file.equals(file)).toBe(true);
    expect(back).toMatchObject({ placed: 3, warnings: ['w'], total: 4 });
  });
});
