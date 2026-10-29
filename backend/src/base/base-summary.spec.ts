import { specialtyGroup, specialtyRows, summaryTable } from './base-summary';

describe('специальности в сводке базы', () => {
  it('разные написания одной специальности — одна строка', () => {
    expect(
      [
        'воп',
        'ВОП фильтр',
        'воп в фильтре',
        'воп гастроэнтеролог', // ВОП — первым по порядку
        'гиниколог',
        'Гинеколог',
        'гастроэтеролог',
        'терапевт дневной стационар',
        'фильтр детский',
        'детский эндокринолог',
        'невролг детский',
        'гл мс',
        'вр днев стационара',
        'лор',
        'Флеболог', // неизвестная — своей строкой
        '',
      ].map(specialtyGroup),
    ).toEqual([
      'ВОП',
      'ВОП',
      'ВОП',
      'ВОП',
      'Гинеколог',
      'Гинеколог',
      'Гастроэнтеролог',
      'Терапевт',
      'Педиатр',
      'Эндокринолог',
      'Невролог',
      'Главная медсестра',
      'Врач дневного стационара',
      'ЛОР',
      'Флеболог',
      'Не указана',
    ]);
  });

  it('частые — выше, «Не указана» — в конце; написания без повторов по регистру', () => {
    expect(
      specialtyRows([
        'воп',
        'ВОП',
        'воп фильтр',
        'лор',
        '',
        'гинеколог',
        'лор',
      ]),
    ).toEqual([
      { label: 'ВОП', spellings: ['воп', 'воп фильтр'], count: 3 },
      { label: 'ЛОР', spellings: ['лор'], count: 2 },
      { label: 'Гинеколог', spellings: ['гинеколог'], count: 1 },
      { label: 'Не указана', spellings: [], count: 1 },
    ]);
  });

  it('формулы: группа — ровно её написания, сумма сходится со «Всего», аптеки — разные по адресу', () => {
    const { rows, byLabel } = summaryTable({
      cols: { fullName: 'D', specialty: 'E', potential: 'J' },
      first: 3,
      last: 2002,
      doctors: [
        { specialty: 'воп', potential: 'Средний' },
        { specialty: 'воп фильтр', potential: 'Низкий' },
        { specialty: 'лор "детский"', potential: '' },
        { specialty: '' },
      ],
      pharmacies: {
        sheet: 'База аптек',
        place: 'E',
        address: 'F',
        first: 2,
        last: 2001,
        count: 7,
      },
    });
    const at = (label: string) => rows[byLabel.get(label)!][1];
    expect(at('ВОП')).toMatchObject({
      formula: 'SUM(COUNTIF($E$3:$E$2002,{"воп","воп фильтр"}))',
      value: 2,
    });
    expect(at('ЛОР').formula).toBe('COUNTIF($E$3:$E$2002,"лор ""детский""")');
    expect(at('Не указана')).toMatchObject({
      formula: 'COUNTIFS($D$3:$D$2002,"<>",$E$3:$E$2002,"")',
      value: 1,
    });
    expect(at('Аптек')).toMatchObject({
      formula:
        "SUMPRODUCT(('База аптек'!$E$2:$E$2001<>\"\")/COUNTIFS('База аптек'!$E$2:$E$2001,'База аптек'!$E$2:$E$2001&\"\",'База аптек'!$F$2:$F$2001,'База аптек'!$F$2:$F$2001&\"\"))",
      value: 7,
    });
    const total = rows.find(([a]) => a.text === 'Всего врачей')![1];
    expect(total.value).toBe(4);
    const groups = ['ВОП', 'ЛОР', 'Не указана'].map((l) => at(l).value!);
    expect(groups.reduce((a, b) => a + b)).toBe(total.value);
    const potential = Object.fromEntries(
      rows
        .slice(byLabel.get('Аптек')! + 3)
        .map(([a, b]): [string, number | undefined] => [a.text ?? '', b.value]),
    );
    expect(potential).toEqual({
      Высокий: 0,
      Средний: 1,
      Низкий: 1,
      'Не указан': 2,
    });
  });
});
