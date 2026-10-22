import { productCells, productCellText } from './products';

describe('productCellText', () => {
  it('как пишут в отчёте', () => {
    expect(productCellText({ code: 'COF_YOGUE' })).toBe('Коф Йог');
    // только остаток — привычный короткий вид
    expect(productCellText({ code: 'COF_YOGUE', stock: 9 })).toBe('Коф Йог 9');
    expect(productCellText({ code: 'LAXSID', stock: 0 })).toBe('Лаксид 0');
  });

  it('аптека: остаток, продажи, дозаказ — пустые не пишем', () => {
    expect(
      productCellText({ code: 'COF_YOGUE', stock: 5, sold: 3, order: 10 }),
    ).toBe('Коф Йог: ост. 5, прод. 3, заказ 10');
    expect(productCellText({ code: 'WORMZWIN', order: 12 })).toBe(
      'Вормзвин: заказ 12',
    );
    expect(productCellText({ code: 'TRIPHALA', stock: 0, sold: 4 })).toBe(
      'Трифала: ост. 0, прод. 4',
    );
  });
});

describe('productCells', () => {
  it('до четырёх — по ячейке на препарат', () => {
    expect(productCells([{ code: 'COF_YOGUE' }, { code: 'LAXSID' }])).toEqual([
      'Коф Йог',
      'Лаксид',
    ]);
  });

  it('больше четырёх — остальные в последнюю ячейку через запятую', () => {
    expect(
      productCells([
        { code: 'COF_YOGUE', stock: 7 },
        { code: 'WORMZWIN' },
        { code: 'TRIPHALA' },
        { code: 'LAXSID', stock: 15 },
        { code: 'TURMERIC' },
        { code: 'CALCIACTIV', stock: 2 },
      ]),
    ).toEqual([
      'Коф Йог 7',
      'Вормзвин',
      'Трифала',
      'Лаксид 15, Куркума, Кальциактив 2',
    ]);
  });
});
