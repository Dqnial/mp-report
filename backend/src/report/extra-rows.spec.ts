import JSZip from 'jszip';
import {
  expandDay,
  fillTemplate,
  placeDay,
  previewDay,
  readFilledRows,
  type DayBlock,
  type VisitCells,
} from './xlsx-template';

/**
 * Визитов больше, чем строк в дне: строки добавляются перед последней строкой
 * дня (у неё жирная нижняя граница), всё ниже сдвигается.
 *
 * Мини-шаблон: шапка 1, день 01.10 — строки 2–5 (ГП 1 в заголовке 2,
 * последняя 5 с границей s=9), день 02.10 — строки 6–9.
 */
const SHEET = 'План и факт';

const cell = (ref: string, s: number, text?: string) =>
  text
    ? `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${text}</t></is></c>`
    : `<c r="${ref}" s="${s}"/>`;

function row(
  r: number,
  opts: {
    last?: boolean;
    date?: string;
    place?: string;
    address?: string;
    filled?: string;
  } = {},
) {
  const s = opts.last ? 9 : 3;
  return (
    `<row r="${r}" spans="1:14" ht="15.75" customHeight="1">` +
    cell(`A${r}`, s) +
    cell(`B${r}`, s) +
    cell(`D${r}`, s, opts.date) +
    cell(`E${r}`, s, opts.place) +
    cell(`F${r}`, s, opts.address) +
    cell(`G${r}`, s, opts.filled) +
    cell(`N${r}`, s) +
    `</row>`
  );
}

async function template(
  lastFilled?: string,
  /** план второго дня (строки 6–9): ЛПУ и адрес каждой строки */
  day2: { place?: string; address?: string }[] = [{ place: 'ГП 2' }],
) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  );
  zip.file(
    'xl/workbook.xml',
    `<workbook><sheets><sheet name="${SHEET}" sheetId="1" r:id="rId1"/></sheets>` +
      `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">&apos;${SHEET}&apos;!$A$1:$N$20</definedName>` +
      `<definedName name="Чужой">&apos;Другой&apos;!$A$1:$A$9</definedName></definedNames></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<worksheet><dimension ref="A1:N9"/>' +
      '<sheetViews><sheetView><selection activeCell="G9" sqref="G9"/></sheetView></sheetViews>' +
      '<sheetData>' +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>шапка</t></is></c></row>` +
      row(2, { date: '01.10.2026', place: 'ГП 1' }) +
      row(3) +
      row(4) +
      row(5, { last: true, filled: lastFilled }) +
      row(6, { date: '02.10.2026', ...day2[0] }) +
      row(7, day2[1]) +
      row(8, day2[2]) +
      row(9, { last: true, ...day2[3] }) +
      '</sheetData><autoFilter ref="A1:N9"/>' +
      '<mergeCells count="2"><mergeCell ref="A2:A5"/><mergeCell ref="A6:A9"/></mergeCells>' +
      '</worksheet>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

const visit = (
  date: string,
  placeName: string,
  fullName: string,
  kind: VisitCells['kind'] = 'DOCTOR',
): VisitCells => ({
  date,
  kind,
  placeName,
  fullName,
  address: `адрес ${placeName}`,
  products: [],
});

async function sheetXml(file: Buffer) {
  const zip = await JSZip.loadAsync(file);
  return {
    sheet: await zip.file('xl/worksheets/sheet1.xml')!.async('string'),
    wb: await zip.file('xl/workbook.xml')!.async('string'),
  };
}

const rowXml = (sheet: string, r: number) =>
  sheet.match(new RegExp(`<row r="${r}"[^>]*>[\\s\\S]*?</row>`))?.[0] ?? '';
const text = (sheet: string, ref: string) =>
  sheet.match(new RegExp(`<c r="${ref}"[^>]*><is><t[^>]*>([^<]*)</t>`))?.[1];

describe('визитов больше, чем строк', () => {
  it('добавляет строки перед последней строкой дня и сдвигает всё ниже', async () => {
    const visits = [1, 2, 3, 4, 5, 6].map((i) =>
      visit('2026-10-01', 'ГП 1', `Врач ${i}`),
    );
    visits.push(visit('2026-10-02', 'ГП 2', 'Врач завтра'));
    const res = await fillTemplate(await template(), visits);

    expect(res.placed).toBe(7);
    expect(res.warnings).toEqual([
      '01.10: визитов больше, чем строк в шаблоне — добавил строк в конце дня: 2',
    ]);
    const { sheet, wb } = await sheetXml(res.file);

    // строки по порядку, без дыр и повторов
    const nums = [...sheet.matchAll(/<row r="(\d+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // все шесть врачей по порядку в 2–7, последняя строка с границей — 7
    expect([2, 3, 4, 5, 6, 7].map((r) => text(sheet, `G${r}`))).toEqual(
      [1, 2, 3, 4, 5, 6].map((i) => `Врач ${i}`),
    );
    expect(rowXml(sheet, 7)).toContain('s="9"');
    // добавленные — с оформлением середины дня, без номера и без ЛПУ («там же»)
    expect(rowXml(sheet, 5)).toContain('<c r="A5" s="3"/>');
    expect(rowXml(sheet, 5)).not.toContain('s="9"');
    expect(text(sheet, 'E5')).toBeUndefined();
    // «Врач»/«Аптека» слева — как в строках шаблона
    expect([5, 6].map((r) => text(sheet, `C${r}`))).toEqual(['Врач', 'Врач']);
    // следующий день сдвинут целиком
    expect(text(sheet, 'D8')).toBe('02.10.2026');
    expect(text(sheet, 'G8')).toBe('Врач завтра');
    // ссылки: объединения дня недели, размеры, фильтр, выделение, имена
    expect(sheet).toContain('<mergeCell ref="A2:A7"/>');
    expect(sheet).toContain('<mergeCell ref="A8:A11"/>');
    expect(sheet).toContain('<dimension ref="A1:N11"/>');
    expect(sheet).toContain('<autoFilter ref="A1:N11"/>');
    expect(sheet).toContain('activeCell="G11" sqref="G11"');
    expect(wb).toContain(`&apos;${SHEET}&apos;!$A$1:$N$22`);
    expect(wb).toContain('&apos;Другой&apos;!$A$1:$A$9'); // чужой лист не трогаем

    // загруженный обратно отчёт читается: 7 визитов, даты верные
    const back = await readFilledRows(res.file);
    expect(back.filled.map((f) => [f.date, f.row])).toEqual([
      ...[2, 3, 4, 5, 6, 7].map((r) => ['2026-10-01', r]),
      ['2026-10-02', 8],
    ]);
    expect(
      back.filled.every(
        (f) => f.groupPlace === (f.date === '2026-10-01' ? 'ГП 1' : 'ГП 2'),
      ),
    ).toBe(true);
  });

  it('влезло — файл не меняется ни на строку', async () => {
    const res = await fillTemplate(await template(), [
      visit('2026-10-01', 'ГП 1', 'Один'),
    ]);
    expect(res.warnings).toEqual([]);
    const { sheet } = await sheetXml(res.file);
    expect(sheet).toContain('<mergeCell ref="A2:A5"/>');
    expect(sheet).toContain('<dimension ref="A1:N9"/>');
  });

  it('ЛПУ не по плану в добавленной строке — записанной последней строке дня подписываем её ЛПУ', async () => {
    // последняя строка 5 уже записана в файле «там же» (под ГП 1)
    const visits = [
      visit('2026-10-01', 'ГП 1', 'Первый'),
      visit('2026-10-01', 'ГП 1', 'Второй'),
      visit('2026-10-01', 'ГП 1', 'Третий'),
      visit('2026-10-01', 'ГП 9', 'Не по плану', 'PHARMACY'),
    ];
    const res = await fillTemplate(await template('Из файла'), visits);
    expect(res.placed).toBe(4);
    const { sheet } = await sheetXml(res.file);
    expect(text(sheet, 'E5')).toBe('ГП 9');
    expect(text(sheet, 'G5')).toBe('Не по плану');
    expect(text(sheet, 'C5')).toBe('Аптека');
    // бывшая строка 5 → 6: своё ЛПУ, чтобы не читалась как «ГП 9»
    expect(text(sheet, 'G6')).toBe('Из файла');
    expect(text(sheet, 'E6')).toBe('ГП 1');

    const back = await readFilledRows(res.file);
    const row6 = back.filled.find((f) => f.row === 6)!;
    expect(row6.groupPlace).toBe('ГП 1');
  });

  it('в листе есть формулы — строки не добавляем, визиты в предупреждении', async () => {
    const zip = await JSZip.loadAsync(await template());
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    zip.file(
      'xl/worksheets/sheet1.xml',
      xml.replace(
        '<c r="N7" s="3"/>',
        '<c r="N7" s="3"><f>COUNTA(G2:G5)</f></c>',
      ),
    );
    const file = await zip.generateAsync({ type: 'nodebuffer' });
    const visits = [1, 2, 3, 4, 5].map((i) =>
      visit('2026-10-01', 'ГП 1', `Врач ${i}`),
    );
    const res = await fillTemplate(file, visits);
    expect(res.placed).toBe(4);
    expect(res.warnings).toEqual([
      '01.10: не хватило строк для 1 визит(ов) — допишите вручную',
    ]);
  });

  it('имя листа в свойствах документа (docProps) — не ссылка: строки добавляются', async () => {
    // Excel пишет список листов в docProps/app.xml — так в любом сохранённом им файле
    const zip = await JSZip.loadAsync(await template());
    zip.file(
      'docProps/app.xml',
      `<Properties><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>${SHEET}</vt:lpstr></vt:vector></TitlesOfParts></Properties>`,
    );
    const file = await zip.generateAsync({ type: 'nodebuffer' });
    const visits = [1, 2, 3, 4, 5].map((i) =>
      visit('2026-10-01', 'ГП 1', `Врач ${i}`),
    );
    const res = await fillTemplate(file, visits);
    expect(res.placed).toBe(5);
    expect(res.warnings).toEqual([
      '01.10: визитов больше, чем строк в шаблоне — добавил строк в конце дня: 1',
    ]);
  });
});

describe('expandDay', () => {
  const day: DayBlock = {
    date: '2026-10-01',
    firstRow: 1,
    lastRow: 3,
    slots: [1, 2, 3].map((row) => ({
      row,
      numbered: true,
      free: row !== 3,
      plannedPlace: row === 1 ? 'ГП 1' : '',
      plannedAddress: '',
      groupPlace: 'ГП 1',
      groupAddress: '',
      label: '',
    })),
  };

  it('строки — перед последней, последняя сдвигается и становится границей', () => {
    const d = expandDay(day, 2);
    expect(d.slots.map((s) => [s.row, !!s.extra, !!s.boundary])).toEqual([
      [1, false, false],
      [2, false, false],
      [3, true, false],
      [4, true, false],
      [5, false, true],
    ]);
    expect(d.lastRow).toBe(5);
  });

  it('граница не попадает в сводку плана и не отдаётся чужому ЛПУ', () => {
    const r = placeDay(expandDay(day, 1), [
      { placeName: 'ГП 1' },
      { placeName: 'ГП 7' },
    ]);
    // ГП 1 — в свой заголовок; ГП 7 открывает группу в свободном хвосте
    // (2 и добавленная 3), но не в строке-границе 4
    expect(r.placements).toEqual([
      { row: 1, newHead: false },
      { row: 2, newHead: true },
    ]);
    expect(r.groups.map((g) => g.place)).toEqual(['ГП 1', 'ГП 7']);
  });
});

describe('previewDay', () => {
  it('строки дня как в файле: добавленные, из приложения, из файла, пустые', async () => {
    const visits = [1, 2, 3, 4].map((i) => ({
      ...visit('2026-10-01', 'ГП 1', `Врач ${i}`),
      id: `c${i}`,
    }));
    // строка 5 (последняя) записана в файле — значит, 4-му визиту нужна новая
    const p = await previewDay(
      await template('Из файла'),
      visits,
      '2026-10-01',
    );
    expect(p.inTemplate).toBe(true);
    expect(
      p.rows.map((r) => [r.row, r.source, r.added, r.visitId ?? '', r.cells.G]),
    ).toEqual([
      [2, 'app', false, 'c1', 'Врач 1'],
      [3, 'app', false, 'c2', 'Врач 2'],
      [4, 'app', false, 'c3', 'Врач 3'],
      [5, 'app', true, 'c4', 'Врач 4'],
      [6, 'file', false, '', 'Из файла'],
    ]);
    expect(p.rows[0].cells.E).toBe('ГП 1');
    expect(p.rows[3].label).toBe('Врач');
    expect(p.warnings).toEqual([
      '01.10: визитов больше, чем строк в шаблоне — добавил строк в конце дня: 1',
    ]);

    // соседний день — без чужих предупреждений, строки сдвинуты на 1
    const next = await previewDay(
      await template('Из файла'),
      visits,
      '2026-10-02',
    );
    expect(next.rows.map((r) => r.row)).toEqual([7, 8, 9, 10]);
    expect(next.rows.every((r) => r.source === 'empty')).toBe(true);
    expect(next.warnings).toEqual([]);

    const none = await previewDay(await template(), visits, '2026-10-03');
    expect(none).toMatchObject({ inTemplate: false, rows: [] });
  });
});

describe('строки плана, куда не сходили', () => {
  // 02.10: четыре аптеки по плану, по строке на каждую, запасных строк нет
  const PLAN = [
    { place: 'Фармленд', address: 'Лесная 10' },
    { place: 'Фармленд', address: 'Садовая 46' },
    { place: 'Аптека плюс', address: 'Речная 5' },
    { place: 'Биосфера', address: 'Озёрная 1' },
  ];

  it('занимаем их визитами не по плану: ЛПУ, адрес и «Аптека» — по факту', async () => {
    const visits: VisitCells[] = [
      // «Фармленд» на Садовая — по плану, строка 7 (а не первая «Фармленд» на Лесная)
      {
        ...visit('2026-10-02', 'Фармленд', 'Провизор 1', 'PHARMACY'),
        address: 'ул. Садовая, 46',
      },
      {
        ...visit('2026-10-02', 'Европа', 'Провизор 2', 'PHARMACY'),
        address: 'Полевая 3',
      },
      {
        ...visit('2026-10-02', 'Без адреса', 'Провизор 3', 'PHARMACY'),
        address: null,
      },
    ];
    const res = await fillTemplate(await template(undefined, PLAN), visits);
    expect(res.placed).toBe(3);
    expect(res.warnings).toEqual([]); // строк не добавляли
    const { sheet } = await sheetXml(res.file);

    expect(text(sheet, 'G7')).toBe('Провизор 1');
    expect(text(sheet, 'E7')).toBe('Фармленд'); // план не тронут
    // «Европа» — в последнюю нетронутую строку плана (Биосфера), план заменён
    expect([
      text(sheet, 'E9'),
      text(sheet, 'F9'),
      text(sheet, 'C9'),
      text(sheet, 'G9'),
    ]).toEqual(['Европа', 'Полевая 3', 'Аптека', 'Провизор 2']);
    // визит без адреса — адрес плана чужой, стираем (стиль ячейки остаётся)
    expect(text(sheet, 'E8')).toBe('Без адреса');
    expect(sheet).toContain('<c r="F8" s="3"/>');
    // куда не сходили и некого вписать — план остаётся
    expect(text(sheet, 'E6')).toBe('Фармленд');
    expect(text(sheet, 'G6')).toBeUndefined();
  });

  it('визитов больше, чем строк плана, — строки добавляем только после этого', async () => {
    const visits = ['А', 'Б', 'В', 'Г', 'Д'].map((x) =>
      visit('2026-10-02', `Аптека ${x}`, `Провизор ${x}`, 'PHARMACY'),
    );
    const res = await fillTemplate(await template(undefined, PLAN), visits);
    expect(res.placed).toBe(5);
    expect(res.warnings).toEqual([
      '02.10: визитов больше, чем строк в шаблоне — добавил строк в конце дня: 1',
    ]);
  });
});
