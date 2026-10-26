import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { fromIsoDate, monthRange, toIsoDate } from '../common/dates';
import { DirectoryService } from '../directory/directory.service';
import { quietRedisErrors } from '../redis/quiet-errors';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  readFilledRows,
  TemplateFormatError,
  type FilledRow,
} from '../report/xlsx-template';
import { rowToVisit } from './row-import';

type Tx = Prisma.TransactionClient;

/** clientId визитов, созданных импортом (у визитов с телефона — свой формат). */
const IMPORTED_PREFIX = 'tpl:';

/** Очередь фонового импорта строк шаблона (BullMQ). */
export const TEMPLATE_QUEUE = 'templates';

export interface ImportJobData {
  userId: string;
  month: string;
}

export interface ImportCounts {
  created: number;
  linked: number;
}

/** Как идёт импорт: сразу (без Redis) или задачей в очереди. */
export type ImportStatus =
  ({ status: 'done' } & ImportCounts) | { status: 'queued'; jobId: string };

/** Сколько ждём постановки в очередь, прежде чем импортировать прямо в запросе. */
const ENQUEUE_TIMEOUT_MS = 2_000;

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`нет ответа за ${ms} мс`)), ms),
    ),
  ]);

/** Шаблоны месяца от руководителя. Файл храним байт в байт, как пришёл. */
@Injectable()
export class TemplatesService {
  private readonly logger = new Logger('Templates');

  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: DirectoryService,
    // без REDIS_URL очередь не подключена — импорт идёт прямо в запросе
    @Optional()
    @InjectQueue(TEMPLATE_QUEUE)
    private readonly queue?: Queue<ImportJobData, ImportCounts>,
    @Optional() private readonly redis?: RedisService,
  ) {
    this.queue?.on('error', quietRedisErrors(this.logger, 'очередь импорта'));
  }

  /**
   * Месяц определяем по датам в шаблоне. Повторная загрузка заменяет файл.
   *
   * Файл проверяем и сохраняем сразу (ошибки формата — пользователю в ответ),
   * а уже заполненные строки превращаем в визиты «из файла» фоновой задачей:
   * это сотни запросов к базе, держать ради них HTTP-запрос незачем. Нет
   * очереди (Redis не настроен или недоступен) — импортируем здесь же.
   */
  async upload(userId: string, originalName: string, file: Buffer) {
    const { month, days, sheetName, filled } = await parseTemplate(file);
    const data = { originalName, file: new Uint8Array(file) };
    const saved = await this.prisma.template.upsert({
      where: { userId_month: { userId, month } },
      create: { ...data, userId, month },
      update: { ...data, createdAt: new Date() },
      select: { id: true, month: true, originalName: true, createdAt: true },
    });
    const importStatus = await this.startImport(userId, month, filled);
    return {
      ...saved,
      sheetName,
      days: days.length,
      firstDay: days[0]?.date,
      lastDay: days.at(-1)?.date,
      import: importStatus,
      // как раньше — когда импорт уже прошёл
      ...(importStatus.status === 'done' && {
        imported: {
          created: importStatus.created,
          linked: importStatus.linked,
        },
      }),
    };
  }

  private async startImport(
    userId: string,
    month: string,
    filled: FilledRow[],
  ): Promise<ImportStatus> {
    // Redis заведомо недоступен — не ждём таймаута постановки в очередь
    if (this.queue && this.redis?.ready) {
      try {
        const job = await withTimeout(
          this.queue.add(
            'import',
            { userId, month },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 2_000 },
              removeOnComplete: { age: 3_600, count: 200 },
              removeOnFail: { age: 7 * 24 * 3_600 },
            },
          ),
          ENQUEUE_TIMEOUT_MS,
        );
        return { status: 'queued', jobId: job.id! };
      } catch (e) {
        // импорт идемпотентен: если задача всё же доедет до очереди позже,
        // она просто перечитает те же строки
        this.logger.warn(
          `очередь недоступна (${(e as Error).message}) — импортирую сразу`,
        );
      }
    }
    return {
      status: 'done',
      ...(await this.importFilled(userId, month, filled)),
    };
  }

  /**
   * Задача очереди: перечитать сохранённый файл месяца и импортировать строки.
   * Идемпотентна — повтор (retry, двойная постановка) даёт тот же результат.
   */
  async importStored(userId: string, month: string) {
    const t = await this.get(userId, month);
    const { filled } = await parseTemplate(t.file);
    return this.importFilled(userId, month, filled);
  }

  private importFilled(userId: string, month: string, filled: FilledRow[]) {
    return this.prisma.$transaction(
      (tx) => this.importRows(tx, userId, month, filled),
      // сотни строк × несколько запросов на справочник
      { timeout: 60_000 },
    );
  }

  /** Состояние фонового импорта — только своего. */
  async importStatus(userId: string, jobId: string) {
    const job = this.queue && (await this.queue.getJob(jobId));
    if (!job || job.data.userId !== userId) {
      throw new NotFoundException('Задача импорта не найдена');
    }
    const state = await job.getState();
    if (state === 'completed') {
      return { status: 'done' as const, ...job.returnvalue };
    }
    if (state === 'failed') {
      return {
        status: 'failed' as const,
        error: job.failedReason ?? 'не удалось прочитать строки файла',
      };
    }
    return { status: 'queued' as const, state, attempts: job.attemptsMade };
  }

  /**
   * Заполненные строки шаблона → визиты «из файла» (templateRow).
   *
   * Созданные импортом визиты за месяц удаляем и читаем заново — файл для них
   * источник правды. Если строка совпадает с визитом, введённым в приложении
   * (дата + ФИО) — значит, загрузили уже выгруженный отчёт: не дублируем, а
   * привязываем тот визит к строке, чтобы экспорт его больше не вписывал.
   * Визиты из приложения никогда не удаляются (их clientId нужен офлайн-синку),
   * а только отвязываются и сопоставляются заново.
   *
   * Визит «из файла», исправленный в приложении, — правка пользователя: если
   * его строка на месте (тот же номер, тот же день), он остаётся к ней
   * привязан (экспорт перепишет строку); строки нет — становится обычным
   * визитом приложения.
   */
  private async importRows(
    tx: Tx,
    userId: string,
    month: string,
    rows: FilledRow[],
  ): Promise<ImportCounts> {
    const { from, to } = monthRange(month);
    const inMonth = { userId, date: { gte: from, lt: to } };
    const parsed = rows.map(rowToVisit);
    const edited = await tx.visit.findMany({
      where: {
        ...inMonth,
        templateRow: { not: null },
        fileEditedAt: { not: null },
      },
    });
    const kept = new Map(
      edited
        .filter((e) =>
          parsed.some(
            (v) =>
              v.templateRow === e.templateRow && v.date === toIsoDate(e.date),
          ),
        )
        .map((e) => [e.templateRow!, e]),
    );
    await this.forgetFileRows(
      tx,
      userId,
      month,
      [...kept.values()].map((e) => e.id),
    );
    // исправленный визит, чья строка теперь другая, освобождает её clientId —
    // строку прочитаем заново под тем же стабильным id
    for (const e of edited) {
      if (kept.has(e.templateRow!) || e.deletedAt) continue;
      if (!e.clientId.startsWith(IMPORTED_PREFIX)) continue;
      await tx.visit.update({
        where: { id: e.id },
        data: { clientId: `mv${randomUUID().replace(/-/g, '')}` },
      });
    }
    const appVisits = await tx.visit.findMany({
      where: { ...inMonth, deletedAt: null },
    });

    let created = 0;
    let linked = 0;
    for (const v of parsed) {
      const date = fromIsoDate(v.date);
      if (kept.has(v.templateRow)) {
        linked++;
        continue;
      }

      const twin = v.fullName
        ? appVisits.find(
            (a) =>
              a.templateRow == null &&
              a.date.getTime() === date.getTime() &&
              a.fullName?.toLowerCase() === v.fullName!.toLowerCase(),
          )
        : undefined;
      if (twin) {
        twin.templateRow = v.templateRow;
        await tx.visit.update({
          where: { id: twin.id },
          data: { templateRow: v.templateRow },
        });
        linked++;
        continue;
      }

      const contactId = await this.directory.learnFromVisit(
        tx,
        userId,
        v,
        'fillMissing',
      );
      await tx.visit.create({
        data: {
          ...v,
          userId,
          contactId,
          date,
          // стабильный id: повторный импорт той же строки даёт тот же clientId
          clientId: `${IMPORTED_PREFIX}${userId}:${month}:${v.templateRow}`,
          products: v.products as unknown as Prisma.InputJsonValue,
        },
      });
      created++;
    }
    return { created, linked };
  }

  /**
   * Убирает связь месяца с файлом: импортированное — удалить, своё — отвязать.
   * Импортированное, но исправленное в приложении — тоже своё (если не
   * удалено). keep — визиты, которые остаются привязанными к строкам.
   */
  private async forgetFileRows(
    tx: Tx,
    userId: string,
    month: string,
    keep: string[] = [],
  ) {
    const { from, to } = monthRange(month);
    const fromFile = {
      userId,
      date: { gte: from, lt: to },
      templateRow: { not: null },
      id: { notIn: keep },
    };
    await tx.visit.deleteMany({
      where: {
        ...fromFile,
        clientId: { startsWith: IMPORTED_PREFIX },
        OR: [{ fileEditedAt: null }, { deletedAt: { not: null } }],
      },
    });
    await tx.visit.updateMany({
      where: fromFile,
      data: { templateRow: null, fileEditedAt: null },
    });
  }

  list(userId: string) {
    return this.prisma.template.findMany({
      where: { userId },
      select: { id: true, month: true, originalName: true, createdAt: true },
      orderBy: { month: 'desc' },
    });
  }

  async find(userId: string, month: string) {
    const t = await this.prisma.template.findUnique({
      where: { userId_month: { userId, month } },
    });
    return t && { ...t, file: Buffer.from(t.file) };
  }

  async get(userId: string, month: string) {
    const t = await this.find(userId, month);
    if (!t) throw new NotFoundException(`Шаблон на ${month} не загружен`);
    return t;
  }

  /** Вместе с шаблоном уходят и импортированные из него визиты. */
  async remove(userId: string, month: string) {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.template.deleteMany({
        where: { userId, month },
      });
      if (count === 0) {
        throw new NotFoundException(`Шаблон на ${month} не загружен`);
      }
      await this.forgetFileRows(tx, userId, month);
    });
  }
}

/** Разбор файла; ошибки формата — 400 с понятным текстом. */
async function parseTemplate(file: Buffer) {
  try {
    return await readFilledRows(file);
  } catch (e) {
    if (e instanceof TemplateFormatError) {
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}
