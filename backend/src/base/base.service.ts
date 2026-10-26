import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { placeMatch } from '../common/place-match';
import { PrismaService } from '../prisma/prisma.service';
import { analyzeTemplate } from '../report/xlsx-template';
import { TemplateFormatError } from '../xlsx/xlsx-xml';
import { buildBaseRows } from './base-rows';
import { analyzeBase, fillBase } from './base-xlsx';

const templateSelect = { originalName: true, createdAt: true } as const;

/** «База врачей и аптек»: файл руководителя + справочник медпреда. */
@Injectable()
export class BaseService {
  constructor(private readonly prisma: PrismaService) {}

  /** Повторная загрузка заменяет файл. */
  async upload(userId: string, originalName: string, file: Buffer) {
    const sheets = await asBadRequest(() => analyzeBase(file));
    // шаблон отчёта тоже содержит «ФИО» и «ЛПУ» — не путаем его с базой
    if (await isReportTemplate(file)) {
      throw new BadRequestException(
        'Это шаблон отчёта, а не база — загрузите его на экране «Отчёт»',
      );
    }
    const data = { originalName, file: new Uint8Array(file) };
    const saved = await this.prisma.baseTemplate.upsert({
      where: { userId },
      create: { ...data, userId },
      update: { ...data, createdAt: new Date() },
      select: templateSelect,
    });
    return { ...saved, sheets };
  }

  async remove(userId: string) {
    const { count } = await this.prisma.baseTemplate.deleteMany({
      where: { userId },
    });
    if (!count) throw new NotFoundException('Файл базы не загружен');
  }

  /** Что попадёт в базу — экран показывает это до отправки. */
  async status(userId: string) {
    const template = await this.prisma.baseTemplate.findUnique({
      where: { userId },
      select: templateSelect,
    });
    const { doctors, pharmacies, merged } = await this.rows(userId);
    return {
      template,
      doctors: doctors.length,
      pharmacies: pharmacies.length,
      merged,
    };
  }

  /** Файл руководителя со справочником внутри — под исходным именем. */
  async build(userId: string) {
    const t = await this.prisma.baseTemplate.findUnique({ where: { userId } });
    if (!t) throw new NotFoundException('Файл базы не загружен');
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fullName: true },
    });
    const rows = await this.rows(userId);
    const result = await fillBase(Buffer.from(t.file), {
      mp: user.fullName,
      ...rows,
    });
    return { ...result, merged: rows.merged, fileName: t.originalName };
  }

  /**
   * Справочник помнит всех, кого когда-либо вводили: опечатки, удалённые
   * визиты, старое ФИО после исправления. В базу — только те, у кого есть
   * живой (не удалённый) визит, из приложения или из файла.
   */
  private async rows(userId: string) {
    const live = { deletedAt: null };
    const [contacts, pharmacies, pharmacyVisits] = await Promise.all([
      this.prisma.contact.findMany({
        where: { userId, hiddenFromBase: false, visits: { some: live } },
        select: {
          fullName: true,
          specialty: true,
          phone: true,
          potential: true,
          place: {
            select: { id: true, kind: true, name: true, address: true },
          },
          visits: {
            where: live,
            select: { kind: true, products: true, date: true },
            orderBy: { date: 'desc' },
          },
        },
      }),
      // аптеки, где провизор не записан, — строкой без ФИО
      this.prisma.place.findMany({
        where: { userId, kind: 'PHARMACY', hiddenFromBase: false },
        select: {
          id: true,
          name: true,
          address: true,
          // и скрытые из базы: аптека со скрытым провизором — не «пустая»
          contacts: { select: { fullName: true } },
        },
      }),
      this.prisma.visit.findMany({
        where: { userId, kind: 'PHARMACY', ...live, placeName: { not: null } },
        select: { placeName: true, address: true },
        distinct: ['placeName', 'address'],
      }),
    ]);
    // у места нет связи с визитами — «есть живой визит» сверяем по названию
    // и адресу, как и при заведении места
    const visited = (p: { name: string; address: string | null }) =>
      pharmacyVisits.some(
        (v) => placeMatch({ name: v.placeName, address: v.address }, p) > 0,
      );
    const emptyPharmacies = pharmacies.filter(
      (p) => !p.contacts.some((c) => c.fullName.trim()) && visited(p),
    );

    // свежие (по последнему визиту) — первыми: при слиянии повторов они главнее
    const last = (c: (typeof contacts)[number]) =>
      c.visits[0]?.date.getTime() ?? 0;
    contacts.sort((a, b) => last(b) - last(a));
    return buildBaseRows(contacts, emptyPharmacies);
  }
}

async function asBadRequest<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TemplateFormatError) {
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

async function isReportTemplate(file: Buffer) {
  try {
    await analyzeTemplate(file);
    return true;
  } catch {
    return false;
  }
}
