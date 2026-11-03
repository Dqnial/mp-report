import JSZip from 'jszip';
import {
  analyzeTemplate,
  dismissPlanned,
  fillTemplate,
  placeDay,
  previewDay,
  readFilledRows,
  type VisitCells,
} from './xlsx-template';

/**
 * План с врачами: строка с ФИО (G–I), но без препаратов и комментария (J–N)
 * — запланированный врач, а не сделанный визит. День 01.10 — строки 2–7:
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

async function template() {
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
    '<worksheet><sheetData>' +
      row(1, { A: 'шапка' }) +
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
      row(7, { B: '6', C: 'Врач' }) +
      '</sheetData></worksheet>',
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

  it('отчёт: в строку врача — препараты и актуальные данные; к кому не дошли — строка плана как была', async () => {
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
    expect([at('G3'), at('I3'), at('J3')]).toEqual([
      'Сидорова Мария',
      '87005556677',
      '',
    ]);
    expect(at('G5')).toBe('Айгуль');
  });

  it('свободных строк нет — добавляются новые, а строки врачей из плана не занимаются', async () => {
    const res = await fillTemplate(await template(), [
      visit('Иванов Пётр'),
      visit('Смирнов Олег'),
      visit('Орлова Ольга'),
    ]);
    expect(res.placed).toBe(3);
    const at = await sheet(res.file);
    // план на месте
    expect([at('G2'), at('G3'), at('G5')]).toEqual([
      'Петрова Анна Ивановна',
      'Сидорова Мария',
      'Айгуль',
    ]);
    expect(at('J2')).toBe('');
    expect(res.warnings.join(' ')).toMatch(/добавил строк/);
  });

  it('предпросмотр: врач из плана без визита — «plan», с визитом — «app», уже был — «file»', async () => {
    const day = await previewDay(
      await template(),
      [visit('Петрова Анна Ивановна')],
      '2026-10-01',
    );
    const src = Object.fromEntries(day.rows.map((r) => [r.row, r.source]));
    expect(src).toMatchObject({
      2: 'app',
      3: 'plan',
      4: 'empty',
      5: 'plan',
      6: 'file',
    });
  });

  describe('врача убрали из плана', () => {
    // ФИО в записи — другим регистром и с лишним пробелом: сравнение их не замечает
    const gone = [{ date: '2026-10-01', fullName: ' сидорова  мария' }];

    it('в плане дня его нет, строка свободна для любого визита', async () => {
      const [day] = (await analyzeTemplate(await template())).days;
      const removed = dismissPlanned([day], gone);
      expect(removed).toEqual([
        {
          date: '2026-10-01',
          row: 3,
          place: 'ГП 1',
          fullName: 'Сидорова Мария',
          specialty: '',
          phone: '87005556677',
        },
      ]);
      const { placements, groups } = placeDay(day, [
        visit('Иванов Пётр'),
        visit('Смирнов Олег'),
      ]);
      expect(groups[0].doctors.map((d) => d.row)).toEqual([2]);
      expect(placements.map((p) => p?.row)).toEqual([3, 4]);
    });

    it('другие дни не трогает', async () => {
      const [day] = (await analyzeTemplate(await template())).days;
      expect(
        dismissPlanned(
          [day],
          [{ date: '2026-10-02', fullName: 'Сидорова Мария' }],
        ),
      ).toEqual([]);
      expect(day.slots.find((s) => s.row === 3)!.planned).toBeDefined();
    });

    it('в отчёте его строка пустая — и когда визитов за день нет', async () => {
      const at = await sheet(
        (await fillTemplate(await template(), [], [], gone)).file,
      );
      expect([at('G3'), at('I3')]).toEqual(['', '']);
      expect(at('G2')).toBe('Петрова Анна Ивановна'); // остальные — как в плане
    });

    it('лёг другой визит — его данные, от убранного ничего не остаётся', async () => {
      const res = await fillTemplate(
        await template(),
        [visit('Петрова Анна Ивановна'), visit('Иванов Пётр')],
        [],
        gone,
      );
      const at = await sheet(res.file);
      expect([at('G3'), at('I3'), at('J3')]).toEqual([
        'Иванов Пётр',
        '',
        'Коф Йог',
      ]);
    });

    it('предпросмотр: строка пустая', async () => {
      const day = await previewDay(
        await template(),
        [],
        '2026-10-01',
        [],
        gone,
      );
      const row = day.rows.find((r) => r.row === 3)!;
      expect(row.source).toBe('empty');
      expect(row.cells.G).toBe('');
    });
  });
});
