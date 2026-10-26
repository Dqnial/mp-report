import type { PrismaService } from '../prisma/prisma.service';
import { DirectoryService } from './directory.service';

/** Справочник без живых визитов уходит, места — по названию и адресу визитов. */
describe('чистка справочника', () => {
  const place = (id: string, name: string, address: string | null) => ({
    id,
    userId: 'u1',
    kind: 'PHARMACY' as const,
    name,
    address,
  });

  function setup() {
    const contactsDelete = jest.fn(() => Promise.resolve({ count: 5 }));
    const placesDelete = jest.fn((args: { where: { id: { in: string[] } } }) =>
      Promise.resolve({ count: args.where.id.in.length }),
    );
    const prisma = {
      contact: { deleteMany: contactsDelete },
      place: {
        findMany: () =>
          Promise.resolve([
            place('a', 'Аптека Фармленд', 'Лесная 10'), // визит есть
            place('b', 'Аптека Фармленд', 'Садовая 46'), // другой филиал, визита нет
            place('c', 'Аптека «Здоровье»', null), // визит удалён
          ]),
        deleteMany: placesDelete,
      },
      visit: {
        findMany: () =>
          Promise.resolve([
            {
              userId: 'u1',
              kind: 'PHARMACY',
              placeName: 'аптека фармленд',
              address: 'ул. Лесная 10',
            },
            // то же название, но визит к врачу — это не аптека
            {
              userId: 'u1',
              kind: 'DOCTOR',
              placeName: 'Аптека «Здоровье»',
              address: null,
            },
          ]),
      },
    } as unknown as PrismaService;
    return {
      service: new DirectoryService(prisma),
      contactsDelete,
      placesDelete,
    };
  }

  it('врачи — только без единого неудалённого визита', async () => {
    const { service, contactsDelete } = setup();
    await service.pruneUnused();
    expect(contactsDelete).toHaveBeenCalledWith({
      where: { visits: { none: { deletedAt: null } } },
    });
  });

  it('место без врачей уходит, если в него не было живого визита', async () => {
    const { service, placesDelete } = setup();
    await expect(service.pruneUnused()).resolves.toEqual({
      contacts: 5,
      places: 2,
    });
    expect(placesDelete).toHaveBeenCalledWith({
      where: { id: { in: ['b', 'c'] } },
    });
  });
});
