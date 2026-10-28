import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { monthRange } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface CachedReport {
  file: Buffer;
  placed: number;
  warnings: string[];
  total: number;
}

/** Готовый отчёт живёт в кеше сутки — дальше всё равно соберётся новый. */
const TTL_SEC = 24 * 3_600;

/**
 * Кеш готового отчёта в Redis.
 *
 * Сборка отчёта — разбор xlsx, раскладка визитов по строкам и запись XML; а
 * экран «Отчёт» запрашивает его дважды (проверка + файл) при каждом открытии.
 *
 * Инвалидация — через версию в ключе, а не удалением: версия складывается из
 * всего, от чего зависит файл, — загрузки шаблона, числа визитов месяца и
 * времени последней правки (в т.ч. удаления — оно мягкое и тоже меняет
 * updatedAt), и сборки бэкенда (новая логика раскладки → новый ключ). Любое
 * изменение даёт новый ключ, старый просто истекает: устаревший отчёт отдать
 * нельзя, а забыть «сбросить кеш» в каком-то месте кода — тоже.
 *
 * Redis недоступен — работаем без кеша (каждый метод глотает ошибки Redis).
 */
@Injectable()
export class ReportCacheService {
  private readonly logger = new Logger('ReportCache');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Версия отчёта для текущего состояния данных и ключ кеша под неё;
   * null — шаблона нет. Версию (короткий хеш) получает и фронт: по ней он
   * понимает, не устарел ли уже скачанный файл.
   */
  async key(userId: string, month: string) {
    const template = await this.prisma.template.findUnique({
      where: { userId_month: { userId, month } },
      select: { id: true, createdAt: true },
    });
    if (!template) return null;
    const { from, to } = monthRange(month);
    const [visits, contacts] = await Promise.all([
      this.prisma.visit.aggregate({
        where: { userId, date: { gte: from, lt: to } },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      // потенциал врача красит строки отчёта — правка справочника тоже новая версия
      this.prisma.contact.aggregate({
        where: { userId },
        _max: { updatedAt: true },
      }),
    ]);
    const version = [
      template.id,
      template.createdAt.getTime(),
      visits._count._all,
      visits._max.updatedAt?.getTime() ?? 0,
      contacts._max.updatedAt?.getTime() ?? 0,
      process.env.APP_BUILD ?? 'dev',
    ].join(':');
    return {
      key: `report:${userId}:${month}:${version}`,
      version: createHash('sha256').update(version).digest('hex').slice(0, 16),
    };
  }

  async get(key: string): Promise<CachedReport | null> {
    if (!this.redis.ready) return null;
    try {
      const raw = await this.redis.client!.get(key);
      if (!raw) return null;
      const v = JSON.parse(raw) as Omit<CachedReport, 'file'> & {
        file: string;
      };
      return { ...v, file: Buffer.from(v.file, 'base64') };
    } catch (e) {
      this.logger.warn(`кеш не прочитан: ${(e as Error).message}`);
      return null;
    }
  }

  async set(key: string, report: CachedReport) {
    if (!this.redis.ready) return;
    try {
      const value = JSON.stringify({
        ...report,
        file: report.file.toString('base64'),
      });
      await this.redis.client!.set(key, value, 'EX', TTL_SEC);
    } catch (e) {
      this.logger.warn(`кеш не записан: ${(e as Error).message}`);
    }
  }
}
