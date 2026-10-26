import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlaceKind, Prisma, VisitKind } from '@prisma/client';
import { fromIsoDate, toIsoDate } from '../common/dates';
import { normPlace, placeMatch } from '../common/place-match';
import { PrismaService } from '../prisma/prisma.service';
import { EditContactDto, EditPlaceDto } from './directory.dto';
import { DirectoryService } from './directory.service';

type Tx = Prisma.TransactionClient;

/** Поля визита, которые повторяют справочник. */
const FIELDS = [
  'fullName',
  'specialty',
  'phone',
  'placeName',
  'address',
] as const;
type Field = (typeof FIELDS)[number];
export type Snapshot = Partial<Record<Field, string | null>>;

const same = (field: Field, a?: string | null, b?: string | null) =>
  field === 'phone'
    ? (a ?? '').replace(/\D/g, '') === (b ?? '').replace(/\D/g, '')
    : normPlace(a ?? '') === normPlace(b ?? '');

/**
 * Что исправить в визите после правки справочника: поле, которое изменили,
 * и только там, где в визите было старое значение. Пустое раньше поле не
 * заполняем — врач мог не дать телефон именно на этом визите.
 */
export function visitFixes(
  visit: Snapshot,
  before: Snapshot,
  after: Snapshot,
): Snapshot {
  const fixes: Snapshot = {};
  for (const f of FIELDS) {
    const was = before[f]?.trim();
    if (!was || (after[f] ?? '') === (before[f] ?? '')) continue;
    if (same(f, visit[f], was)) fixes[f] = after[f]?.trim() || null;
  }
  return fixes;
}

/** Сегодня (UTC) как @db.Date — дата, с которой известен потенциал из правки. */
const today = () => fromIsoDate(new Date().toISOString().slice(0, 10));

/**
 * Экран «Справочник»: врачи и аптеки как в «Базе врачей и аптек», правка
 * карточки (с исправлением тех же опечаток в визитах месяца), потенциал,
 * «не включать в базу».
 */
@Injectable()
export class DirectoryEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: DirectoryService,
  ) {}

  async entries(userId: string) {
    const [contacts, pharmacies, pharmacyVisits] = await Promise.all([
      this.prisma.contact.findMany({
        where: { userId },
        select: {
          id: true,
          fullName: true,
          specialty: true,
          phone: true,
          potential: true,
          hiddenFromBase: true,
          place: { select: { kind: true, name: true, address: true } },
          visits: {
            where: { deletedAt: null },
            select: { date: true, kind: true },
            orderBy: { date: 'desc' },
          },
        },
      }),
      this.prisma.place.findMany({
        where: { userId, kind: PlaceKind.PHARMACY },
        select: {
          id: true,
          name: true,
          address: true,
          hiddenFromBase: true,
          contacts: { select: { fullName: true } },
        },
      }),
      this.prisma.visit.findMany({
        where: { userId, kind: VisitKind.PHARMACY, deletedAt: null },
        select: { placeName: true, address: true, date: true },
        orderBy: { date: 'desc' },
      }),
    ]);

    const contactEntry = (c: (typeof contacts)[number]) => ({
      type: 'contact' as const,
      id: c.id,
      fullName: c.fullName,
      specialty: c.specialty,
      phone: c.phone,
      placeName: c.place?.name ?? null,
      address: c.place?.address ?? null,
      potential: c.potential,
      hiddenFromBase: c.hiddenFromBase,
      visits: c.visits.length,
      lastVisit: c.visits[0] ? toIsoDate(c.visits[0].date) : null,
    });
    // провизор — по месту; без места — по последнему визиту (как в базе)
    const isPharmacist = (c: (typeof contacts)[number]) =>
      c.place
        ? c.place.kind === PlaceKind.PHARMACY
        : c.visits[0]?.kind === VisitKind.PHARMACY;

    const emptyPharmacies = pharmacies
      .filter((p) => !p.contacts.some((c) => c.fullName.trim()))
      .map((p) => {
        const visits = pharmacyVisits.filter(
          (v) => placeMatch({ name: v.placeName, address: v.address }, p) > 0,
        );
        return {
          type: 'place' as const,
          id: p.id,
          fullName: null,
          specialty: null,
          phone: null,
          placeName: p.name,
          address: p.address,
          potential: null,
          hiddenFromBase: p.hiddenFromBase,
          visits: visits.length,
          lastVisit: visits[0] ? toIsoDate(visits[0].date) : null,
        };
      });

    return {
      doctors: contacts.filter((c) => !isPharmacist(c)).map(contactEntry),
      pharmacies: [
        ...contacts.filter(isPharmacist).map(contactEntry),
        ...emptyPharmacies,
      ],
    };
  }

  async editContact(userId: string, id: string, dto: EditContactDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const old = await tx.contact.findFirst({
        where: { id, userId },
        include: { place: true },
      });
      if (!old) throw new NotFoundException('Запись не найдена');

      const fullName = dto.fullName ?? old.fullName;
      if (fullName.toLowerCase() !== old.fullName.toLowerCase()) {
        const twin = await tx.contact.findFirst({
          where: {
            userId,
            id: { not: id },
            fullName: { equals: fullName, mode: 'insensitive' },
          },
        });
        if (twin) {
          throw new ConflictException(`«${fullName}» уже есть в справочнике`);
        }
      }

      const place =
        dto.placeName !== undefined || dto.address !== undefined
          ? await this.movePlace(tx, userId, old, dto)
          : old.place;

      const contact = await tx.contact.update({
        where: { id },
        data: {
          fullName,
          ...(dto.specialty !== undefined && {
            specialty: dto.specialty || null,
          }),
          ...(dto.phone !== undefined && { phone: dto.phone || null }),
          placeId: place?.id ?? null,
          ...(dto.potential !== undefined && {
            potential: dto.potential,
            potentialDate: dto.potential ? today() : null,
          }),
          ...(dto.hiddenFromBase !== undefined && {
            hiddenFromBase: dto.hiddenFromBase,
          }),
          editedAt: new Date(),
        },
      });

      const fixed = dto.fixVisitsFrom
        ? await this.fixVisits(
            tx,
            userId,
            { contactId: id },
            dto.fixVisitsFrom,
            {
              fullName: old.fullName,
              specialty: old.specialty,
              phone: old.phone,
              placeName: old.place?.name,
              address: old.place?.address,
            },
            {
              fullName: contact.fullName,
              specialty: contact.specialty,
              phone: contact.phone,
              placeName: place?.name,
              address: place?.address,
            },
          )
        : 0;
      return { id, fixedVisits: fixed };
    });
    return result;
  }

  async editPlace(userId: string, id: string, dto: EditPlaceDto) {
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.place.findFirst({ where: { id, userId } });
      if (!old) throw new NotFoundException('Запись не найдена');
      const place = await tx.place.update({
        where: { id },
        data: {
          name: dto.name ?? old.name,
          ...(dto.address !== undefined && { address: dto.address || null }),
          ...(dto.hiddenFromBase !== undefined && {
            hiddenFromBase: dto.hiddenFromBase,
          }),
        },
      });
      const kind =
        old.kind === PlaceKind.PHARMACY ? VisitKind.PHARMACY : VisitKind.DOCTOR;
      const fixed = dto.fixVisitsFrom
        ? await this.fixVisits(
            tx,
            userId,
            { kind },
            dto.fixVisitsFrom,
            { placeName: old.name, address: old.address },
            { placeName: place.name, address: place.address },
            // визиты именно в это место, а не в филиал с тем же названием
            (v) =>
              placeMatch({ name: v.placeName, address: v.address }, old) > 0,
          )
        : 0;
      return { id, fixedVisits: fixed };
    });
  }

  /**
   * ЛПУ/аптека в карточке изменилась. Опечатка в адресе того же места или
   * место только у этого врача — правим само место; иначе врач переходит
   * в другое (найденное по названию и адресу или новое).
   */
  private async movePlace(
    tx: Tx,
    userId: string,
    old: Prisma.ContactGetPayload<{ include: { place: true } }>,
    dto: EditContactDto,
  ) {
    const name = (dto.placeName ?? old.place?.name ?? '').trim();
    const address =
      (dto.address !== undefined ? dto.address : old.place?.address)?.trim() ||
      null;
    if (!name) return null;
    const kind = old.place?.kind ?? PlaceKind.CLINIC;
    const found = await this.directory.findPlace(
      tx,
      userId,
      kind,
      name,
      address,
    );
    const alone =
      !!old.place &&
      (await tx.contact.count({
        where: { placeId: old.place.id, id: { not: old.id } },
      })) === 0;
    const target =
      found?.id === old.place?.id || (!found && alone) ? old.place : found;
    if (target) {
      if (target.name === name && (target.address ?? null) === address) {
        return target;
      }
      return tx.place.update({
        where: { id: target.id },
        data: { name, address: address ?? target.address },
      });
    }
    return tx.place.create({ data: { userId, kind, name, address } });
  }

  /**
   * Исправить визиты с даты from: в каждом — только поля, где было старое
   * значение. Время правки — сейчас, чтобы телефоны приняли серверную
   * версию; визит «из файла» помечается исправленным (экспорт перепишет
   * его строку).
   */
  private async fixVisits(
    tx: Tx,
    userId: string,
    where: Prisma.VisitWhereInput,
    from: string,
    before: Snapshot,
    after: Snapshot,
    match: (v: {
      placeName: string | null;
      address: string | null;
    }) => boolean = () => true,
  ) {
    const visits = await tx.visit.findMany({
      where: {
        ...where,
        userId,
        deletedAt: null,
        date: { gte: fromIsoDate(from) },
      },
    });
    let fixed = 0;
    for (const v of visits) {
      if (!match(v)) continue;
      const fixes = visitFixes(v, before, after);
      if (!Object.keys(fixes).length) continue;
      const now = new Date();
      await tx.visit.update({
        where: { id: v.id },
        data: {
          ...fixes,
          clientUpdatedAt: now,
          ...(v.templateRow != null && { fileEditedAt: now }),
        },
      });
      fixed++;
    }
    return fixed;
  }
}
