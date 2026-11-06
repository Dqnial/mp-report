import JSZip from 'jszip';
import {
  analyzeTemplate,
  fillTemplate,
  placeDay,
  previewDay,
  readFilledRows,
  type VisitCells,
} from './xlsx-template';

/**
 * План с врачами: строка с ФИО (G–I), но без препаратов и комментария (J–N)
 * — запланированный врач, а не сделанный визит. Нет визита — нет и в отчёте. День 01.10 — строки 2–7:
 *  2 ГП 1, Лесная 1 — Петрова Анна Ивановна (план)
 *  3 там же — Сидорова Мария (план, без отчества)
 *  4 там же — пусто
 *  5 Аптека А — Айгуль (план)
 *  6 там же — Кузнецов Иван, уже был (N заполнено)
 *  7 последняя строка дня — пусто
 */
const COLS = 'ABCDEFGHIJKLMN';
const row = (r: number, v: Partial<Record<string, string>> = {}) =>
  `<row r="${r}">${[...COLS]
    .map((c) =>
      v[c]
        ? `<c r="${c}${r}" s="3" t="inlineStr"><is><t>${v[c]}</t></is></c>`
        : `<c r="${c}${r}" s="3"/>`,
    )
    .join('')}</row>`;

async function template(
  sheetRows = row(1, { A: 'шапка' }) +
    row(2, {
      B: '1',
      C: 'Врач',
      D: '01.10.2026',
      E: 'ГП 1',
      F: 'Лесная 1',
      G: 'Петрова Анна Ивановна',
      H: 'ВОП',
      I: '87001112233',
    }) +
    row(3, { B: '2', C: 'Врач', G: 'Сидорова Мария', I: '87005556677' }) +
    row(4, { B: '3', C: 'Врач' }) +
    row(5, { B: '4', C: 'Аптека', E: 'Аптека А', G: 'Айгуль' }) +
    row(6, { B: '5', C: 'Аптека', G: 'Кузнецов Иван', N: 'был' }) +
    row(7, { B: '6', C: 'Врач' }),
) {
  const zip = new JSZip();
  zip.file(
    'xl/workbook.xml',
    '<workbook><sheets><sheet name="План" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<worksheet><sheetData>' + sheetRows + '</sheetData></worksheet>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

const visit = (
  fullName: string,
  more: Partial<VisitCells> = {},
): VisitCells => ({
  id: fullName,
  date: '2026-10-01',
  kind: 'DOCTOR',
  placeName: 'ГП 1',
  address: 'Лесная 1',
  fullName,
  products: ['Коф Йог'],
  ...more,
});

async function sheet(file: Buffer) {
  const xml = await (
    await JSZip.loadAsync(file)
  )
    .file('xl/worksheets/sheet1.xml')!
    .async('string');
  return (ref: string) =>
    xml.match(new RegExp(`<c r="${ref}"[^>]*><is><t[^>]*>([^<]*)</t>`))?.[1] ??
    '';
}

describe('план с врачами', () => {
  it('строка только с ФИО — врач из плана, не визит; с препаратами/комментарием — визит', async () => {
    const file = await template();
    const [day] = (await analyzeTemplate(file)).days;
    const byRow = new Map(day.slots.map((s) => [s.row, s]));
    expect(byRow.get(2)).toMatchObject({
      free: true,
      planned: {
        fullName: 'Петрова Анна Ивановна',
        specialty: 'ВОП',
        phone: '87001112233',
      },
    });
    expect(byRow.get(4)!.planned).toBeUndefined();
    expect(byRow.get(6)).toMatchObject({ free: false });
    // импорт берёт только сделанный визит
    const { filled } = await readFilledRows(file);
    expect(filled.map((f) => f.row)).toEqual([6]);
  });

  it('визит — в строку своего врача, даже если вписан после других; чужой врач строку не занимает', async () => {
    const [day] = (await analyzeTemplate(await template())).days;
    const { placements, groups } = placeDay(day, [
      visit('Иванов Пётр'), // не из плана — в пустую строку ГП 1
      visit('Петрова Анна Ивановна'),
    ]);
    expect(placements.map((p) => p?.row)).toEqual([4, 2]);
    expect(groups[0].doctors).toEqual([
      {
        row: 2,
        fullName: 'Петрова Анна Ивановна',
        specialty: 'ВОП',
        phone: '87001112233',
        visited: true,
      },
      {
        row: 3,
        fullName: 'Сидорова Мария',
        specialty: '',
        phone: '87005556677',
        visited: false,
      },
    ]);
    expect(groups[1].doctors).toEqual([
      { row: 5, fullName: 'Айгуль', specialty: '', phone: '', visited: false },
    ]);
  });

  it('ФИО и телефон меняются: опечатка в отчестве, отчество дописали, ФИО сменили — по телефону', async () => {
    const [day] = (await analyzeTemplate(await template())).days;
    const at = (v: VisitCells) => placeDay(day, [v]).placements[0]?.row;
    expect(at(visit('петрова анна иванова'))).toBe(2); // опечатка, регистр
    expect(at(visit('Сидорова Мария Петровна'))).toBe(3); // без отчества в плане, то же ЛПУ
    expect(
      at(visit('Ким Мария', { phone: '+7 700 555 66 77' })), // сменила фамилию, номер тот же
    ).toBe(3);
    // общий номер регистратуры у другого врача — не повод занять его строку
    expect(at(visit('Ахметов Ержан', { phone: '87005556677' }))).not.toBe(3);
    // ФИО не записали, номер тот же — он
    expect(at(visit('', { phone: '87005556677' }))).toBe(3);
    // тёзка в другом месте без телефона — не тот человек: обычная свободная строка
    expect(
      at(
        visit('Сидорова Мария Олеговна', {
          placeName: 'ГП 9',
          address: 'Садовая 2',
        }),
      ),
    ).not.toBe(3);
  });

  it('визит без ФИО с тем же телефоном не отнимает строку у визита к самому врачу', async () => {
    const [day] = (await analyzeTemplate(await template())).days;
    const { placements } = placeDay(day, [
      visit('', { phone: '87005556677' }), // записан раньше
      visit('Сидорова Мария'),
    ]);
    expect(placements.map((p) => p?.row)).toEqual([4, 3]);
  });

  it('отчёт: визит к врачу — с актуальными данными; к кому не дошли — их нет', async () => {
    const res = await fillTemplate(await template(), [
      visit('Петрова Анна Ивановна', {
        phone: '87009998877', // новый номер
        specialty: '',
        comment: 'посмотрит',
      }),
    ]);
    const at = await sheet(res.file);
    expect(at('G2')).toBe('Петрова Анна Ивановна');
    expect(at('H2')).toBe('ВОП'); // в визите пусто — остаётся из плана
    expect(at('I2')).toBe('87009998877');
    expect(at('J2')).toBe('Коф Йог');
    expect(at('N2')).toBe('посмотрит');
    // уже записанный в файле визит — следующей строкой, номер по порядку
    expect(at('G3')).toBe('Кузнецов Иван');
    expect(at('B3')).toBe('2');
    // аптека осталась только у него — ЛПУ подписано, хотя её строка удалена
    expect([at('E3'), at('N3')]).toEqual(['Аптека А', 'был']);
    expect(at('G4')).toBe('');
    const xml = await (
      await JSZip.loadAsync(res.file)
    )
      .file('xl/worksheets/sheet1.xml')!
      .async('string');
    expect(xml).not.toContain('Сидорова');
    expect(xml).not.toContain('Айгуль');
  });

  it('день без визитов остаётся планом, но без ФИО', async () => {
    const sheetRows =
      row(1, { A: 'шапка' }) +
      row(2, {
        B: '1',
        D: '01.10.2026',
        E: 'ГП 1',
        F: 'Лесная 1',
        G: 'Петрова Анна Ивановна',
        H: 'ВОП',
        I: '87001112233',
      }) +
      row(3, { B: '2', G: 'Сидорова Мария' });
    const at = await sheet(
      (await fillTemplate(await template(sheetRows), [])).file,
    );
    expect([at('D2'), at('E2'), at('F2'), at('B3')]).toEqual([
      '01.10.2026',
      'ГП 1',
      'Лесная 1',
      '2',
    ]);
    expect(['G2', 'H2', 'I2', 'G3'].map(at)).toEqual(['', '', '', '']);
    const day = await previewDay(await template(sheetRows), [], '2026-10-01');
    expect(day.rows.map((r) => r.source)).toEqual(['empty', 'empty']);
  });

  it('другой врач занимает строку планового в своём ЛПУ; от планового ничего не остаётся', async () => {
    const file = await template();
    const visits = [
      visit('Иванов Пётр'),
      visit('Смирнов Олег'),
      visit('Орлова Ольга'),
    ];
    const [day] = (await analyzeTemplate(file)).days;
    const { placements, groups } = placeDay(day, visits);
    expect(placements.map((p) => p?.row)).toEqual([4, 2, 3]);
    // в плане не отмечены: визит был не к ним
    expect(groups[0].doctors.map((d) => d.visited)).toEqual([false, false]);

    const res = await fillTemplate(file, visits);
    expect(res.placed).toBe(3);
    expect(res.warnings).toEqual([]);
    const at = await sheet(res.file);
    expect([at('G2'), at('G3'), at('G4')]).toEqual([
      'Смирнов Олег',
      'Орлова Ольга',
      'Иванов Пётр',
    ]);
    expect(['H2', 'I2', 'I3'].map(at)).toEqual(['', '', '']);
  });

  it('провизор сменился: визит в аптеку занимает её строку, а не уходит в конец дня', async () => {
    const file = await template(
      row(1, { A: 'шапка' }) +
        row(2, {
          B: '1',
          C: 'Врач',
          D: '01.10.2026',
          E: 'Аптека А',
          F: 'Лесная 1',
          G: 'Айгуль',
          H: 'провизор',
          I: '87001112233',
        }) +
        row(3, { B: '2', C: 'Врач', E: 'ГП 1', G: 'Петрова Анна Ивановна' }),
    );
    const res = await fillTemplate(file, [
      visit('Новая Провизор', {
        kind: 'PHARMACY',
        placeName: 'Аптека А',
        address: 'Лесная 1',
      }),
    ]);
    expect(res.warnings).toEqual([]);
    const at = await sheet(res.file);
    expect([at('E2'), at('F2'), at('C2'), at('G2')]).toEqual([
      'Аптека А',
      'Лесная 1',
      'Аптека',
      'Новая Провизор',
    ]);
    expect(['H2', 'I2'].map(at)).toEqual(['', '']);
    expect(at('G3')).toBe('');
  });

  it('все строки дня с врачами, визит не по плану: добавляется ровно нужная строка, ничего не теряется', async () => {
    // последняя строка дня — тоже врач из плана
    const file = await template(
      row(1, { A: 'шапка' }) +
        row(2, {
          B: '1',
          D: '01.10.2026',
          E: 'ГП 1',
          G: 'Петрова Анна Ивановна',
        }) +
        row(3, { B: '2', G: 'Сидорова Мария' }) +
        row(4, { B: '1', D: '02.10.2026', E: 'ГП 2', G: 'Завтрашний Врач' }),
    );
    const res = await fillTemplate(file, [
      visit('Петрова Анна Ивановна'),
      visit('Сидорова Мария'),
      visit('Чужой Врач', { placeName: 'ГП 9', address: 'Садовая 2' }),
    ]);
    expect(res.placed).toBe(3);
    expect(res.warnings).toEqual([
      '01.10: визитов больше, чем строк в шаблоне — добавил строк в конце дня: 1',
    ]);
    const at = await sheet(res.file);
    expect([at('G2'), at('G3'), at('G4')]).toEqual([
      'Петрова Анна Ивановна',
      'Чужой Врач',
      'Сидорова Мария',
    ]);
    expect([at('E3'), at('F3')]).toEqual(['ГП 9', 'Садовая 2']);
    // Сидорова не переехала под чужое ЛПУ
    expect(at('E4')).toBe('ГП 1');
    expect(at('D5')).toBe('02.10.2026');
  });

  it('предпросмотр: только строки с визитами', async () => {
    const day = await previewDay(
      await template(),
      [visit('Петрова Анна Ивановна')],
      '2026-10-01',
    );
    expect(day.rows.map((r) => [r.row, r.source, r.num])).toEqual([
      [2, 'app', '1'],
      [3, 'file', '2'],
    ]);
  });
});
