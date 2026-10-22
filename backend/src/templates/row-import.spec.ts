import { guessKind, parseProducts } from './row-import';

// строки — как реально пишут в отчётах
const codes = (...texts: string[]) =>
  parseProducts(texts).map((p) =>
    p.stock == null ? p.code : `${p.code}:${p.stock}`,
  );

describe('parseProducts', () => {
  it.each([
    ['Коф йог', ['COF_YOGUE']],
    ['Кофйог ', ['COF_YOGUE']],
    ['Коф   Йог', ['COF_YOGUE']],
    ['коф иог', ['COF_YOGUE']],
    ['Кoф Йог', ['COF_YOGUE']], // латинская o
    ['Кальцийактив', ['CALCIACTIV']],
    ['Кальций актив 9, Вормзвин 7', ['CALCIACTIV:9', 'WORMZWIN:7']],
    ['Калцийактив', ['CALCIACTIV']],
    ['Кальиактив', ['CALCIACTIV']],
    ['Кайцийактив ', ['CALCIACTIV']],
    ['Мальцийактив', ['CALCIACTIV']],
    ['Тррифола', ['TRIPHALA']],
    ['Тифала', ['TRIPHALA']],
    ['Ворымзвин', ['WORMZWIN']],
    ['Влормзвин', ['WORMZWIN']],
    ['Лаксиж', ['LAXSID']],
    ['Трифала1 Лаксид2', ['TRIPHALA:1', 'LAXSID:2']],
    ['Коф йог 7 и Вормзвин 10', ['COF_YOGUE:7', 'WORMZWIN:10']],
    ['Коф йогКуркума', ['COF_YOGUE', 'TURMERIC']],
    [
      'Коф Йог 7Кальцийактив 15,Лаксид 15,Трифала 16,Вормзвин 8, Куркума 6',
      [
        'COF_YOGUE:7',
        'CALCIACTIV:15',
        'LAXSID:15',
        'TRIPHALA:16',
        'WORMZWIN:8',
        'TURMERIC:6',
      ],
    ],
    [
      'Коф йог 183,Кальцийактив 133,Вормзвин 199, Ьаксид 109 Ерифала 113, Куркума 40',
      [
        'COF_YOGUE:183',
        'CALCIACTIV:133',
        'WORMZWIN:199',
        'LAXSID:109',
        'TRIPHALA:113',
        'TURMERIC:40',
      ],
    ],
    ['Коф йог было 0 потом дозакажут 15', ['COF_YOGUE']],
    ['Коф йог  0', ['COF_YOGUE:0']],
    ['Куркума 3, Лакси 15', ['TURMERIC:3', 'LAXSID:15']],
    ['нет', []],
    ['сказала закажет', []],
    ['хирург', []],
  ])('%s', (text, expected) => {
    expect(codes(text)).toEqual(expected);
  });

  it('несколько ячеек, повтор препарата не задваивается', () => {
    expect(codes('Коф йог', 'Куркума', 'Коф Йог')).toEqual([
      'COF_YOGUE',
      'TURMERIC',
    ]);
  });
});

describe('guessKind', () => {
  const row = (C: string, E: string, H: string) => ({ C, E, H });
  it('по специальности, а не по метке C', () => {
    expect(guessKind(row('Аптека', '', 'ВОП'))).toBe('DOCTOR');
    expect(guessKind(row('Врач', '', 'провизор'))).toBe('PHARMACY');
    expect(guessKind(row('Врач', '', 'зав аптекой '))).toBe('PHARMACY');
    expect(guessKind(row('Врач', '', 'фармацевт'))).toBe('PHARMACY');
  });
  it('без специальности — по названию места, потом по метке', () => {
    expect(guessKind(row('Врач', 'Аптека Мейрам', ''))).toBe('PHARMACY');
    expect(guessKind(row('Аптека ', '', ''))).toBe('PHARMACY');
    expect(guessKind(row('врач', '', ''))).toBe('DOCTOR');
  });
});
