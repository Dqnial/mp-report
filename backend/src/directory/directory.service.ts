import { Injectable, NotFoundException } from '@nestjs/common';
import { PlaceKind, Prisma, VisitKind } from '@prisma/client';
import { fromIsoDate } from '../common/dates';
import { addressMatch, placeMatch } from '../common/place-match';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateContactDto,
  CreatePlaceDto,
  UpdateContactDto,
  UpdatePlaceDto,
} from './directory.dto';

type Tx = Prisma.TransactionClient;

const placeKindFor = (kind: VisitKind) =>
  kind === VisitKind.PHARMACY ? PlaceKind.PHARMACY : PlaceKind.CLINIC;

const contactInclude = {
  place: { select: { id: true, kind: true, name: true, address: true } },
} satisfies Prisma.ContactInclude;

/** Справочник ЛПУ/аптек и врачей/провизоров — источник автоподстановки. */
@Injectable()
export class DirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── ЛПУ / аптеки ──────────────────────────────────────────────────────────

  searchPlaces(userId: string, q?: string, kind?: PlaceKind) {
    return this.prisma.place.findMany({
      where: {
        userId,
        kind,
        ...(q && { name: { contains: q, mode: 'insensitive' } }),
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
  }

  createPlace(userId: string, dto: CreatePlaceDto) {
    return this.prisma.place.create({ data: { ...dto, userId } });
  }

  async updatePlace(userId: string, id: string, dto: UpdatePlaceDto) {
    await this.ownPlace(userId, id);
    return this.prisma.place.update({ where: { id }, data: dto });
  }

  async deletePlace(userId: string, id: string) {
    await this.ownPlace(userId, id);
    await this.prisma.place.delete({ where: { id } });
  }

  // ─── врачи / провизоры ─────────────────────────────────────────────────────

  /**
   * Весь справочник одним запросом — телефон хранит его у себя, чтобы
   * подсказки по ФИО и ЛПУ работали без интернета. Недавние — первыми.
   */
  async all(userId: string) {
    const [places, contacts] = await Promise.all([
      this.prisma.place.findMany({
        where: { userId },
        select: {
          id: true,
          kind: true,
          name: true,
          address: true,
          lastAgreement: true,
          lastAgreementDate: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.contact.findMany({
        where: { userId },
        select: {
          id: true,
          fullName: true,
          specialty: true,
          phone: true,
          placeId: true,
          lastAgreement: true,
          lastAgreementDate: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);
    return { places, contacts };
  }

  /** Поиск по ФИО для автоподстановки; недавно использованные — выше. */
  searchContacts(userId: string, q?: string) {
    return this.prisma.contact.findMany({
      where: {
        userId,
        ...(q && { fullName: { contains: q, mode: 'insensitive' } }),
      },
      include: contactInclude,
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
  }

  async createContact(userId: string, dto: CreateContactDto) {
    if (dto.placeId) await this.ownPlace(userId, dto.placeId);
    return this.prisma.contact.create({
      data: { ...dto, userId },
      include: contactInclude,
    });
  }

  async updateContact(userId: string, id: string, dto: UpdateContactDto) {
    await this.ownContact(userId, id);
    if (dto.placeId) await this.ownPlace(userId, dto.placeId);
    return this.prisma.contact.update({
      where: { id },
      data: dto,
      include: contactInclude,
    });
  }

  async deleteContact(userId: string, id: string) {
    await this.ownContact(userId, id);
    await this.prisma.contact.delete({ where: { id } });
  }

  // ─── пополнение из визитов ─────────────────────────────────────────────────

  /**
   * Справочник растёт сам: каждый визит заводит/обновляет ЛПУ и контакт,
   * чтобы в следующий раз всё подставилось по ФИО. Совпадение — без учёта
   * регистра. Пустые поля визита не затирают уже известные значения.
   *
   * fillMissing — для импорта старых строк из файла: только дополняем
   * справочник, не перетирая то, что уже узнали из свежих визитов.
   */
  async learnFromVisit(
    tx: Tx,
    userId: string,
    v: {
      kind: VisitKind;
      placeName?: string | null;
      address?: string | null;
      fullName?: string | null;
      specialty?: string | null;
      phone?: string | null;
      date?: string | Date;
      agreement?: string | null;
    },
    mode: 'overwrite' | 'fillMissing' = 'overwrite',
  ): Promise<string | null> {
    const prefer = <T>(
      fresh: T | null | undefined,
      known: T | null | undefined,
    ) => (mode === 'overwrite' ? fresh || known : known || fresh);
    // «не дала телефон» и т.п. в справочник не тащим — в визите останется как есть
    const phone =
      (v.phone?.replace(/\D/g, '').length ?? 0) >= 6 ? v.phone : null;

    // Договорённость переносится на следующий визит: у аптеки — в эту аптеку
    // (провизоры меняются), у врача — к этому врачу. Берём с самого позднего
    // по дате визита: правка старого визита свежую не затрёт.
    const visitDate = typeof v.date === 'string' ? fromIsoDate(v.date) : v.date;
    const agreementFor = (known: Date | null | undefined) =>
      mode === 'overwrite' &&
      !!v.agreement &&
      !!visitDate &&
      (!known || known <= visitDate)
        ? { lastAgreement: v.agreement, lastAgreementDate: visitDate }
        : {};
    const onPlace = v.kind === VisitKind.PHARMACY && !!v.placeName;

    let placeId: string | undefined;
    if (v.placeName) {
      const kind = placeKindFor(v.kind);
      // одно место — название И адрес: у сети аптек одно название на много
      // адресов. Адрес совпал — это оно; у места нет адреса — допишем; адреса
      // разные — другой филиал, новое место. Без адреса — последнее по времени.
      const sameName = await tx.place.findMany({
        where: {
          userId,
          kind,
          name: { equals: v.placeName, mode: 'insensitive' },
        },
        orderBy: { updatedAt: 'desc' },
      });
      const place = v.address?.trim()
        ? sameName
            .map((p) => ({ p, score: addressMatch(v.address, p.address) }))
            .filter((c) => c.score > 0)
            // точное совпадение адреса раньше, чем «у места адреса нет»
            .sort((a, b) => b.score - a.score)[0]?.p
        : sameName[0];
      placeId = place
        ? (
            await tx.place.update({
              where: { id: place.id },
              // updatedAt поднимает место в поиске, даже если адрес тот же
              data: {
                address: prefer(v.address, place.address),
                ...(onPlace && agreementFor(place.lastAgreementDate)),
              },
            })
          ).id
        : (
            await tx.place.create({
              data: {
                userId,
                kind,
                name: v.placeName,
                address: v.address,
                ...(onPlace && agreementFor(null)),
              },
            })
          ).id;
    }

    if (!v.fullName) return null;
    const contact = await tx.contact.findFirst({
      where: {
        userId,
        fullName: { equals: v.fullName, mode: 'insensitive' },
      },
    });
    const data = {
      specialty: prefer(v.specialty, contact?.specialty),
      phone: prefer(phone, contact?.phone),
      placeId: prefer(placeId, contact?.placeId),
      ...(!onPlace && agreementFor(contact?.lastAgreementDate)),
    };
    const saved = contact
      ? await tx.contact.update({ where: { id: contact.id }, data })
      : await tx.contact.create({
          data: { ...data, userId, fullName: v.fullName },
        });
    return saved.id;
  }

  // ─── уборка ───────────────────────────────────────────────────────────────

  /**
   * Убрать из справочника тех, кого нет ни в одном живом визите: опечатки,
   * врачей из удалённых визитов, старое ФИО после исправления визита. Иначе
   * они вечно всплывают в подсказках. Ничего не теряется: визиты ссылаются
   * на справочник необязательно (при удалении — null), а восстановленный или
   * новый визит заведёт врача заново.
   *
   * Место — без врачей и без живого визита с тем же названием и адресом
   * (у места нет прямой связи с визитами — сверяем, как при заведении).
   */
  async pruneUnused() {
    const contacts = await this.prisma.contact.deleteMany({
      where: { visits: { none: { deletedAt: null } } },
    });

    const empty = await this.prisma.place.findMany({
      where: { contacts: { none: {} } },
      select: { id: true, userId: true, kind: true, name: true, address: true },
    });
    if (!empty.length) return { contacts: contacts.count, places: 0 };
    const visits = await this.prisma.visit.findMany({
      where: {
        userId: { in: [...new Set(empty.map((p) => p.userId))] },
        deletedAt: null,
        placeName: { not: null },
      },
      select: { userId: true, kind: true, placeName: true, address: true },
      distinct: ['userId', 'kind', 'placeName', 'address'],
    });
    const unused = empty.filter(
      (p) =>
        !visits.some(
          (v) =>
            v.userId === p.userId &&
            placeKindFor(v.kind) === p.kind &&
            placeMatch({ name: v.placeName, address: v.address }, p) > 0,
        ),
    );
    const places = await this.prisma.place.deleteMany({
      where: { id: { in: unused.map((p) => p.id) } },
    });
    return { contacts: contacts.count, places: places.count };
  }

  private async ownPlace(userId: string, id: string) {
    const found = await this.prisma.place.findFirst({ where: { id, userId } });
    if (!found) throw new NotFoundException('ЛПУ не найдено');
    return found;
  }

  private async ownContact(userId: string, id: string) {
    const found = await this.prisma.contact.findFirst({
      where: { id, userId },
    });
    if (!found) throw new NotFoundException('Контакт не найден');
    return found;
  }
}
