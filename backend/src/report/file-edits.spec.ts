import JSZip from 'jszip';
import {
  fillTemplate,
  previewDay,
  type FileRowEdit,
  type VisitCells,
} from './xlsx-template';

/**
 * Визиты «из файла», исправленные в приложении. День 01.10 — строки 2–5:
 * ГП 1 в заголовке (2), в 2–4 уже записаны врачи «там же», 5 — свободна.
 */
const cell = (ref: string, text?: string) =>
  text
    ? `<c r="${ref}" s="3" t="inlineStr"><is><t>${text}</t></is></c>`
    : `<c r="${ref}" s="3"/>`;

const COLS = 'ABCDEFGHIJKLMN';

function row(r: number, values: Partial<Record<string, string>>) {
  return `<row r="${r}">${[...COLS].map((c) => cell(`${c}${r}`, values[c])).join('')}</row>`;
}

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
        G: 'Иванова',
      }) +
      row(3, { B: '2', C: 'Врач', G: 'Петрва', H: 'ВОП', J: 'Коф йог 7' }) +
      row(4, { B: '3', C: 'Врач', G: 'Сидорова' }) +
      row(5, { B: '4', C: 'Врач' }) +
      '</sheetData></worksheet>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

const edited = (more: Partial<VisitCells> = {}): VisitCells => ({
  id: 'tpl:row3',
  date: '2026-10-01',
  kind: 'DOCTOR',
  placeName: 'ГП 1',
  address: 'Лесная 1',
  fullName: 'Петрова Анна',
  specialty: 'ВОП',
  products: ['Лаксид'],
  ...more,
});

async function cells(edits: FileRowEdit[]) {
  const res = await fillTemplate(await template(), [], edits);
  const xml = await (
    await JSZip.loadAsync(res.file)
  )
    .file('xl/worksheets/sheet1.xml')!
    .async('string');
  return (ref: string) =>
    xml.match(new RegExp(`<c r="${ref}"[^>]*><is><t[^>]*>([^<]*)</t>`))?.[1] ??
    '';
}

describe('исправленные визиты «из файла»', () => {
  it('правка перезаписывает колонки визита в своей строке; препараты без правки — как в файле', async () => {
    const at = await cells([{ row: 3, visit: edited(), keepProducts: true }]);
    expect(at('G3')).toBe('Петрова Анна');
    expect(at('H3')).toBe('ВОП');
    expect(at('J3')).toBe('Коф йог 7'); // исходный текст — не распознанный заново
    expect(at('E3')).toBe(''); // то же ЛПУ — строка остаётся «там же»
    expect(at('G2')).toBe('Иванова'); // соседние строки не тронуты
    expect(at('G4')).toBe('Сидорова');
  });

  it('препараты исправили — J–M пишутся заново', async () => {
    const at = await cells([{ row: 3, visit: edited() }]);
    expect(at('J3')).toBe('Лаксид');
  });

  it('удалённый визит очищает строку, план в заголовке остаётся', async () => {
    const at = await cells([{ row: 3, visit: null }]);
    expect(['G3', 'H3', 'J3'].map(at)).toEqual(['', '', '']);
    expect(at('E2')).toBe('ГП 1');
  });

  it('другое ЛПУ — пишется в строку, а строке ниже возвращается прежнее', async () => {
    const at = await cells([
      {
        row: 3,
        visit: edited({ placeName: 'ГП 9', address: 'Садовая 4' }),
        keepProducts: true,
      },
    ]);
    expect([at('E3'), at('F3')]).toEqual(['ГП 9', 'Садовая 4']);
    // Сидорова была «там же» под ГП 1 — не должна переехать под ГП 9
    expect([at('E4'), at('F4')]).toEqual(['ГП 1', 'Лесная 1']);
  });

  it('предпросмотр показывает правку как визит приложения, удалённый — пустой строкой', async () => {
    const file = await template();
    const fixedDay = await previewDay(file, [], '2026-10-01', [
      { row: 3, visit: edited(), keepProducts: true },
      { row: 4, visit: null },
    ]);
    const byRow = new Map(fixedDay.rows.map((r) => [r.row, r]));
    expect(byRow.get(3)).toMatchObject({
      source: 'app',
      visitId: 'tpl:row3',
      cells: { G: 'Петрова Анна' },
    });
    expect(byRow.get(4)?.source).toBe('empty');
    expect(byRow.get(2)?.source).toBe('file');
  });

  it('свободные строки дня по-прежнему занимают новые визиты', async () => {
    const res = await fillTemplate(
      await template(),
      [{ ...edited({ id: 'new', fullName: 'Новикова' }), products: [] }],
      [{ row: 3, visit: edited(), keepProducts: true }],
    );
    expect(res.placed).toBe(1);
    const xml = await (
      await JSZip.loadAsync(res.file)
    )
      .file('xl/worksheets/sheet1.xml')!
      .async('string');
    expect(xml).toContain('Новикова');
    expect(xml).toContain('Петрова Анна');
  });
});
