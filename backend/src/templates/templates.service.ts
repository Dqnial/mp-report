import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { fromIsoDate, monthRange } from '../common/dates';
import { DirectoryService } from '../directory/directory.service';
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

/** Шаблоны месяца от руководителя. Файл храним байт в байт, как пришёл. */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: DirectoryService,
  ) {}

  /**
   * Месяц определяем по датам в шаблоне. Повторная загрузка заменяет файл.
   * Уже заполненные строки становятся визитами «из файла» (см. importRows).
   */
  async upload(userId: string, originalName: string, file: Buffer) {
    let parsed: Awaited<ReturnType<typeof readFilledRows>>;
    try {
      parsed = await readFilledRows(file);
    } catch (e) {
      if (e instanceof TemplateFormatError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }
    const { month, days, sheetName, filled } = parsed;

    return this.prisma.$transaction(
      async (tx) => {
        const data = { originalName, file: new Uint8Array(file) };
        const saved = await tx.template.upsert({
          where: { userId_month: { userId, month } },
          create: { ...data, userId, month },
          update: { ...data, createdAt: new Date() },
          select: {
            id: true,
            month: true,
            originalName: true,
            createdAt: true,
          },
        });
        const imported = await this.importRows(tx, userId, month, filled);
        return {
          ...saved,
          sheetName,
          days: days.length,
          firstDay: days[0]?.date,
          lastDay: days.at(-1)?.date,
          imported,
        };
      },
      // сотни строк × несколько запросов на справочник
      { timeout: 60_000 },
    );
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
   */
  private async importRows(
    tx: Tx,
    userId: string,
    month: string,
    rows: FilledRow[],
  ) {
    const { from, to } = monthRange(month);
    const inMonth = { userId, date: { gte: from, lt: to } };
    await this.forgetFileRows(tx, userId, month);
    const appVisits = await tx.visit.findMany({
      where: { ...inMonth, deletedAt: null },
    });

    let created = 0;
    let linked = 0;
    for (const row of rows) {
      const v = rowToVisit(row);
      const date = fromIsoDate(v.date);

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

  /** Убирает связь месяца с файлом: импортированное — удалить, своё — отвязать. */
  private async forgetFileRows(tx: Tx, userId: string, month: string) {
    const { from, to } = monthRange(month);
    const fromFile = {
      userId,
      date: { gte: from, lt: to },
      templateRow: { not: null },
    };
    await tx.visit.deleteMany({
      where: { ...fromFile, clientId: { startsWith: IMPORTED_PREFIX } },
    });
    await tx.visit.updateMany({ where: fromFile, data: { templateRow: null } });
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
