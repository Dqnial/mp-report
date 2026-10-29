import {
  buildBaseRows,
  pharmacyRows,
  samePerson,
  type DirectoryContact,
  type PharmacyVisit,
} from './base-rows';

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
  it('повторы сводятся: полное ФИО, свежие данные, препараты из всех визитов, потенциал', () => {
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
          // отмечен только у старой записи — всё равно попадает
          potential: 'HIGH',
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
        potential: 'Высокий',
      },
    ]);
  });

  it('врачи — из справочника, по ЛПУ и ФИО; провизоры в справочнике в их число не входят', () => {
    const rows = buildBaseRows(
      [
        contact('Яковлева Ольга', { place: clinic('ГП 10') }),
        contact('Борисова Ольга', { place: clinic('ГП 10') }),
        contact('Антонова Ольга', { place: clinic('ГП 2') }),
        contact('Айгуль', {
          specialty: 'провизор',
          place: { kind: 'PHARMACY', name: 'Аптека Б', address: null },
        }),
        // без места, но последний визит — в аптеку
        contact('Мадина', {
          place: null,
          visits: [{ kind: 'PHARMACY', products: [] }],
        }),
        contact('', { place: clinic('ГП 2') }), // без ФИО — не строка
      ],
      [],
    );
    expect(rows.doctors.map((d) => d.fullName)).toEqual([
      'Антонова Ольга', // ГП 2 раньше ГП 10
      'Борисова Ольга',
      'Яковлева Ольга',
    ]);
    expect(rows.pharmacies).toEqual([]);
  });

  it('нет номера, а в визите написано «телефон не дала» — так и пишем', () => {
    const rows = buildBaseRows(
      [
        contact('Петрова Анна', {
          visits: [
            { kind: 'DOCTOR', products: [], phone: 'телефон не дала' },
            { kind: 'DOCTOR', products: [], phone: null },
          ],
        }),
        // номер в справочнике есть — он главнее текста в визите
        contact('Сидорова Мария', {
          phone: '87001112233',
          visits: [{ kind: 'DOCTOR', products: [], phone: 'не дает номер' }],
        }),
      ],
      [],
    );
    expect(rows.doctors.map((d) => [d.fullName, d.phone])).toEqual([
      ['Петрова Анна', 'телефон не дала'],
      ['Сидорова Мария', '87001112233'],
    ]);
  });
});

describe('аптеки — из визитов', () => {
  const v = (
    placeName: string,
    fullName: string | null,
    more: Partial<PharmacyVisit> = {},
  ): PharmacyVisit => ({
    placeName,
    address: 'Тестовая 1',
    fullName,
    specialty: null,
    phone: null,
    ...more,
  });

  it('тёзки в разных аптеках — каждая в своей строке; данные — из визитов в эту аптеку', () => {
    const rows = pharmacyRows([
      // новые первыми
      v('Рауза фарм', 'Айгуль', {
        address: 'Свердлова 13',
        phone: 'не дала телефон',
      }),
      v('Рауза фарм', 'Айгуль', {
        address: 'Нурлыкент 100',
        phone: '87001112233',
      }),
      v('Рауза фарм', 'Айгуль', {
        address: 'Нурлыкент 100',
        specialty: 'фармацевт',
        phone: '87000000000',
      }),
      v('Фармаком', null), // провизора не записали
      v('Фармаком', 'Индира', { address: 'Тестовая 1' }),
      v('Аптека А', null), // в аптеку ходили, провизора ни разу не записали
    ]);
    expect(rows).toEqual([
      {
        place: 'Аптека А',
        address: 'Тестовая 1',
        fullName: '',
        specialty: '',
        phone: '',
      },
      {
        place: 'Рауза фарм',
        address: 'Нурлыкент 100',
        fullName: 'Айгуль',
        specialty: 'фармацевт',
        phone: '87001112233', // самый свежий
      },
      {
        place: 'Рауза фарм',
        address: 'Свердлова 13',
        fullName: 'Айгуль',
        specialty: '',
        phone: 'не дала телефон',
      },
      // строки без ФИО у аптеки, где провизор есть, — нет
      {
        place: 'Фармаком',
        address: 'Тестовая 1',
        fullName: 'Индира',
        specialty: '',
        phone: '',
      },
    ]);
  });
});
