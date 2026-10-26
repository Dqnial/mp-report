import { visitFixes } from './directory-edit.service';

/** Правка справочника → те же опечатки в визитах месяца. */
describe('исправление визитов после правки справочника', () => {
  const before = {
    fullName: 'Петрва Анна',
    specialty: 'ВОП',
    phone: '8 700 111 22 33',
    placeName: 'ГП 1',
    address: 'Лесная 1',
  };

  it('меняет только изменённые поля и только там, где было старое значение', () => {
    expect(
      visitFixes(
        {
          fullName: 'петрва  анна', // регистр и пробелы не важны
          specialty: 'ВОП',
          phone: '87001112233', // тот же номер в другом написании
          placeName: 'ГП 1',
          address: 'Лесная 1',
        },
        before,
        { ...before, fullName: 'Петрова Анна', phone: '87009998877' },
      ),
    ).toEqual({ fullName: 'Петрова Анна', phone: '87009998877' });
  });

  it('пустое в визите не заполняет: врач мог не дать телефон на этом визите', () => {
    expect(
      visitFixes({ fullName: 'Петрва Анна', phone: null }, before, {
        ...before,
        fullName: 'Петрова Анна',
        phone: '87009998877',
      }),
    ).toEqual({ fullName: 'Петрова Анна' });
  });

  it('в визите было другое значение — не трогаем', () => {
    expect(
      visitFixes({ fullName: 'Петрва Анна', placeName: 'ГП 7' }, before, {
        ...before,
        placeName: 'ГП 2',
      }),
    ).toEqual({});
  });

  it('стёртое в справочнике поле стирается и в визите', () => {
    expect(
      visitFixes({ fullName: 'Петрва Анна', specialty: 'ВОП' }, before, {
        ...before,
        specialty: null,
      }),
    ).toEqual({ specialty: null });
  });
});
