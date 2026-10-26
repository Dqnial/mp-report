import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Visit } from '@prisma/client';
import { fromIsoDate, monthRange, toIsoDate } from '../common/dates';
import { DirectoryService } from '../directory/directory.service';
import { PrismaService } from '../prisma/prisma.service';
import type { VisitProduct } from '../products';
import {
  CreateVisitDto,
  SyncVisitDto,
  UpdateVisitDto,
  VisitProductDto,
  VisitsQuery,
} from './visits.dto';

/** Один препарат — один раз: повторное нажатие на кнопку не задвоит строку. */
function uniqueProducts(products: VisitProductDto[]): VisitProduct[] {
  const seen = new Set<string>();
  return products.flatMap((p) => {
    if (seen.has(p.code)) return [];
    seen.add(p.code);
    // пустые числа не храним — в отчёте их не должно быть видно
    const { code, stock, sold, order } = p;
    return [
      {
        code,
        ...(stock != null && { stock }),
        ...(sold != null && { sold }),
        ...(order != null && { order }),
      },
    ];
  });
}

export const toVisitView = (v: Visit) => ({
  ...v,
  date: toIsoDate(v.date),
  products: v.products as unknown as VisitProduct[],
  /** уже записан в файле шаблона: правка перезапишет его строку в отчёте */
  fromFile: v.templateRow != null,
});

/** Последнее, что известно о визите по времени устройства: правка или удаление. */
const lastChange = (v: Visit) =>
  Math.max(v.clientUpdatedAt?.getTime() ?? 0, v.deletedAt?.getTime() ?? 0);

/** Поиск отдаёт не больше — дальше просят уточнить запрос. */
const SEARCH_LIMIT = 200;

/** День в порядке строк файла, затем введённые в приложении — по времени. */
const DAY_ORDER: Prisma.VisitOrderByWithRelationInput[] = [
  { date: 'asc' },
  { templateRow: { sort: 'asc', nulls: 'last' } },
  { createdAt: 'asc' },
];

/**
 * Визит «из файла» можно исправить или удалить — экспорт перезапишет (или
 * очистит) его строку. Но не перенести на другой день: строка — в блоке
 * своего дня, и запись в чужой день испортила бы файл.
 */
function fileEdit(v: Visit, date?: string, products?: VisitProductDto[]) {
  if (v.templateRow == null) return {};
  if (date && date !== toIsoDate(v.date)) {
    throw new BadRequestException(
      'Визит из файла нельзя перенести на другой день — удалите его и добавьте новый',
    );
  }
  // препараты исправили — J–M пишем заново; иначе в файле остаётся как было
  // (там бывает то, что распознать не удалось)
  const productsEdited =
    !!products &&
    JSON.stringify(uniqueProducts(products)) !== JSON.stringify(v.products);
  return {
    fileEditedAt: new Date(),
    ...(productsEdited && { productsRaw: null }),
  };
}

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: DirectoryService,
  ) {}

  async list(userId: string, query: VisitsQuery) {
    let date: Prisma.DateTimeFilter;
    if (query.date) date = { equals: fromIsoDate(query.date) };
    else if (query.month) {
      const { from, to } = monthRange(query.month);
      date = { gte: from, lt: to };
    } else throw new BadRequestException('Укажите date или month');

    const visits = await this.prisma.visit.findMany({
      where: { userId, date, deletedAt: null },
      orderBy: DAY_ORDER,
    });
    return visits.map(toVisitView);
  }

  /**
   * Поиск по всем месяцам. Регистр и ё/е не важны; телефон — по цифрам
   * (8 701 123… находится по «701123»). Новые сверху, не больше SEARCH_LIMIT.
   */
  async search(userId: string, q: string) {
    const text = q.trim().toLowerCase().replace(/ё/g, 'е');
    const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = q.replace(/\D/g, '');
    const found = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM visits
      WHERE "userId" = ${userId}::uuid AND "deletedAt" IS NULL AND (
        translate(lower(concat_ws(' ', "fullName", "placeName", address,
          specialty, comment, agreement, fact, deviation, "productsRaw")),
          'ё', 'е') LIKE ${like}
        OR (${digits.length >= 3}
          AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`})
      )
      ORDER BY date DESC, "createdAt" DESC
      LIMIT ${SEARCH_LIMIT + 1}`;
    const ids = found.slice(0, SEARCH_LIMIT).map((r) => r.id);
    const visits = await this.prisma.visit.findMany({
      where: { id: { in: ids } },
    });
    const order = new Map(ids.map((id, i) => [id, i]));
    visits.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return {
      visits: visits.map(toVisitView),
      truncated: found.length > SEARCH_LIMIT,
    };
  }

  /**
   * Офлайн-синк: телефон присылает полное состояние визита и время правки.
   * Создаёт или обновляет. Если на сервере уже есть более поздняя правка или
   * удаление (с другого устройства) — не применяем и возвращаем серверное.
   * Повтор того же запроса безопасен.
   */
  async sync(
    userId: string,
    clientId: string,
    dto: SyncVisitDto,
  ): Promise<{ visit: ReturnType<typeof toVisitView>; applied: boolean }> {
    const { updatedAt, ...fields } = dto;
    const at = new Date(updatedAt);
    const existing = await this.byClientId(userId, clientId);

    if (existing) {
      if (lastChange(existing) >= at.getTime()) {
        return { visit: toVisitView(existing), applied: false };
      }
      const edited = fileEdit(existing, fields.date, fields.products);
      const visit = await this.prisma.$transaction(async (tx) => {
        const contactId = await this.directory.learnFromVisit(
          tx,
          userId,
          fields,
        );
        return tx.visit.update({
          where: { id: existing.id },
          data: {
            ...this.visitData(fields),
            // это полное состояние: чего нет в новой версии — очищаем
            placeName: fields.placeName ?? null,
            address: fields.address ?? null,
            fullName: fields.fullName ?? null,
            specialty: fields.specialty ?? null,
            phone: fields.phone ?? null,
            comment: fields.comment ?? null,
            agreement: fields.agreement ?? null,
            fact: fields.fact ?? null,
            deviation: fields.deviation ?? null,
            potential: fields.potential ?? null,
            contactId,
            clientUpdatedAt: at,
            deletedAt: null,
            ...edited,
          },
        });
      });
      return { visit: toVisitView(visit), applied: true };
    }

    try {
      const visit = await this.prisma.$transaction(async (tx) => {
        const contactId = await this.directory.learnFromVisit(
          tx,
          userId,
          fields,
        );
        return tx.visit.create({
          data: {
            ...this.visitData(fields),
            userId,
            clientId,
            contactId,
            clientUpdatedAt: at,
          },
        });
      });
      return { visit: toVisitView(visit), applied: true };
    } catch (e) {
      // тот же визит пришёл параллельно — повторяем, теперь как обновление
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return this.sync(userId, clientId, dto);
      }
      throw e;
    }
  }

  /** Офлайн-удаление: мягкое, если на сервере нет более поздней правки. */
  async syncDelete(userId: string, clientId: string, updatedAt: string) {
    const at = new Date(updatedAt);
    const existing = await this.byClientId(userId, clientId);
    // визита нет (создание так и не дошло) — удалять нечего, это не ошибка
    if (!existing) return;
    if (lastChange(existing) >= at.getTime()) return;
    await this.prisma.visit.update({
      where: { id: existing.id },
      data: { deletedAt: at, ...fileEdit(existing) },
    });
  }

  private visitData(fields: Omit<SyncVisitDto, 'updatedAt'>) {
    return {
      ...fields,
      date: fromIsoDate(fields.date),
      products: uniqueProducts(
        fields.products,
      ) as unknown as Prisma.InputJsonValue,
    };
  }

  /**
   * Идемпотентно по clientId: телефон может отправить визит повторно после
   * обрыва связи — вернём уже сохранённый, а не создадим дубль.
   */
  async create(userId: string, dto: CreateVisitDto) {
    const existing = await this.byClientId(userId, dto.clientId);
    if (existing) return { visit: toVisitView(existing), created: false };

    try {
      const visit = await this.prisma.$transaction(async (tx) => {
        const contactId = await this.directory.learnFromVisit(tx, userId, dto);
        return tx.visit.create({
          data: {
            ...dto,
            userId,
            contactId,
            date: fromIsoDate(dto.date),
            products: uniqueProducts(
              dto.products,
            ) as unknown as Prisma.InputJsonValue,
            clientUpdatedAt: new Date(),
          },
        });
      });
      return { visit: toVisitView(visit), created: true };
    } catch (e) {
      // параллельная отправка того же визита — второй запрос получит первый
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const raced = await this.byClientId(userId, dto.clientId);
        if (raced) return { visit: toVisitView(raced), created: false };
      }
      throw e;
    }
  }

  async update(userId: string, id: string, dto: UpdateVisitDto) {
    const current = await this.own(userId, id);
    const edited = fileEdit(current, dto.date, dto.products);
    const visit = await this.prisma.$transaction(async (tx) => {
      const merged = { ...current, ...dto };
      const contactId = await this.directory.learnFromVisit(tx, userId, merged);
      return tx.visit.update({
        where: { id },
        data: {
          ...dto,
          contactId,
          date: dto.date ? fromIsoDate(dto.date) : undefined,
          products: dto.products
            ? (uniqueProducts(dto.products) as unknown as Prisma.InputJsonValue)
            : undefined,
          clientUpdatedAt: new Date(),
          ...edited,
        },
      });
    });
    return toVisitView(visit);
  }

  /** Удаление мягкое — запись остаётся (синк других устройств, восстановление). */
  async remove(userId: string, id: string) {
    const current = await this.own(userId, id);
    await this.prisma.visit.update({
      where: { id },
      data: { deletedAt: new Date(), ...fileEdit(current) },
    });
  }

  /** Исправленные или удалённые в приложении визиты «из файла» — их строки экспорт перезапишет. */
  fileEdits(userId: string, month: string) {
    const { from, to } = monthRange(month);
    return this.prisma.visit.findMany({
      where: {
        userId,
        date: { gte: from, lt: to },
        templateRow: { not: null },
        fileEditedAt: { not: null },
      },
    });
  }

  /** Визиты месяца для отчёта — кроме тех, что уже записаны в файле. */
  forReport(userId: string, month: string) {
    const { from, to } = monthRange(month);
    return this.prisma.visit.findMany({
      where: {
        userId,
        date: { gte: from, lt: to },
        templateRow: null,
        deletedAt: null,
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async byClientId(userId: string, clientId: string) {
    const found = await this.prisma.visit.findUnique({ where: { clientId } });
    if (found && found.userId !== userId) {
      throw new ConflictException('clientId уже занят');
    }
    return found;
  }

  private async own(userId: string, id: string) {
    const found = await this.prisma.visit.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!found) throw new NotFoundException('Визит не найден');
    return found;
  }
}
