import { buildBaseRows, samePerson, type DirectoryContact } from './base-rows';

const contact = (
  fullName: string,
  more: Partial<DirectoryContact> = {},
): DirectoryContact => ({
  fullName,
  specialty: 'ВОП',
  phone: null,
  place: { kind: 'CLINIC', name: 'ГП 1', address: 'Тестовая 1' },
  visits: [],
  ...more,
});

const clinic = (name: string) => ({
  kind: 'CLINIC' as const,
  name,
  address: null,
});

describe('один ли это врач', () => {
  it('без отчества в одной записи — тот же, если то же ЛПУ или специальность', () => {
    expect(
      samePerson(contact('Петрова Анна'), contact('Петрова Анна Ивановна')),
    ).toBe(true);
    expect(
      samePerson(
        contact('Петрова Анна', {
          specialty: 'Педиатр',
          place: clinic('ГП 2'),
        }),
        contact('Петрова Анна Ивановна', { place: clinic('ГП 9') }),
      ),
    ).toBe(false); // тёзки из разных поликлиник
  });

  it('опечатка в отчестве и регистр/ё не важны, другое отчество — другой человек', () => {
    expect(
      samePerson(
        contact('Сидорова Мария Тулегеновна'),
        contact('сидорова мария толегеновна', { place: clinic('Другая') }),
      ),
    ).toBe(true);
    expect(
      samePerson(
        contact('Сидорова Мария Петровна'),
        contact('Сидорова Мария Ивановна'),
      ),
    ).toBe(false);
    expect(
      samePerson(contact('Сидорова Мария'), contact('Иванова Мария')),
    ).toBe(false);
  });
});

describe('строки базы', () => {
  it('повторы сводятся: полное ФИО, свежие данные, препараты из всех визитов', () => {
    const rows = buildBaseRows(
      [
        // свежая запись — первой
        contact('Петрова Анна', {
          phone: '87001112233',
          visits: [{ kind: 'DOCTOR', products: [{ code: 'LAXSID' }] }],
        }),
        contact('Петрова Анна Ивановна', {
          phone: '87000000000',
          specialty: null,
          visits: [
            {
              kind: 'DOCTOR',
              products: [{ code: 'COF_YOGUE' }, { code: 'LAXSID' }],
            },
          ],
        }),
      ],
      [],
    );
    expect(rows.merged).toBe(1);
    expect(rows.doctors).toEqual([
      {
        fullName: 'Петрова Анна Ивановна',
        specialty: 'ВОП',
        phone: '87001112233',
        place: 'ГП 1',
        address: 'Тестовая 1',
        products: 'Лаксид, Коф Йог',
      },
    ]);
  });

  it('врачи — по ЛПУ и ФИО, аптеки — отдельно, с аптеками без провизора', () => {
    const pharmacy = {
      kind: 'PHARMACY' as const,
      name: 'Аптека Б',
      address: 'Тестовая 3',
    };
    const rows = buildBaseRows(
      [
        contact('Яковлева Ольга', { place: clinic('ГП 10') }),
        contact('Борисова Ольга', { place: clinic('ГП 10') }),
        contact('Антонова Ольга', { place: clinic('ГП 2') }),
        contact('Айгуль', { specialty: 'провизор', place: pharmacy }),
        // без места, но последний визит — в аптеку
        contact('Мадина', {
          place: null,
          visits: [{ kind: 'PHARMACY', products: [] }],
        }),
        contact('', { place: clinic('ГП 2') }), // без ФИО — не строка
      ],
      [{ name: 'Аптека А', address: null }],
    );
    expect(rows.doctors.map((d) => d.fullName)).toEqual([
      'Антонова Ольга', // ГП 2 раньше ГП 10
      'Борисова Ольга',
      'Яковлева Ольга',
    ]);
    expect(rows.pharmacies.map((p) => [p.place, p.fullName])).toEqual([
      ['', 'Мадина'],
      ['Аптека А', undefined],
      ['Аптека Б', 'Айгуль'],
    ]);
  });
});
