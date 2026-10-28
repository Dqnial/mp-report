import JSZip from 'jszip';
import {
  fillTemplate,
  POTENTIAL_FILL,
  previewDay,
  type RowPotentials,
  type VisitCells,
} from './xlsx-template';

/**
 * Цвет строки по потенциалу врача. День 01.10 — строки 2–4: в 2 уже записан
 * врач из файла, 3–4 свободны. Стили: две стандартные заливки, форматы 0 и 3.
 */
const COLS = 'ABCDEFGHIJKLMN';
const row = (r: number, values: Partial<Record<string, string>> = {}) =>
  `<row r="${r}">${[...COLS]
    .map((c) =>
      values[c]
        ? `<c r="${c}${r}" s="3" t="inlineStr"><is><t>${values[c]}</t></is></c>`
        : `<c r="${c}${r}" s="3"/>`,
    )
    .join('')}</row>`;

const STYLES =
  '<styleSheet><fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="49" fontId="3" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment wrapText="1"/></xf>' +
  '</cellXfs></styleSheet>';

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
  zip.file('xl/styles.xml', STYLES);
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<worksheet><sheetData>' +
      row(1, { A: 'шапка' }) +
      row(2, { B: '1', D: '01.10.2026', E: 'ГП 1', G: 'Из файла' }) +
      row(3, { B: '2' }) +
      row(4, { B: '3' }) +
      '</sheetData></worksheet>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

const visit: VisitCells = {
  id: 'v1',
  date: '2026-10-01',
  kind: 'DOCTOR',
  placeName: 'ГП 1',
  fullName: 'Новикова',
  products: [],
};

const potentials = (): RowPotentials => ({
  byVisit: new Map([['v1', 'HIGH']]),
  byTemplateRow: new Map([[2, 'LOW']]),
});

async function parts(file: Buffer) {
  const zip = await JSZip.loadAsync(file);
  const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  const styles = await zip.file('xl/styles.xml')!.async('string');
  const style = (ref: string) =>
    sheet.match(new RegExp(`<c r="${ref}"[^>]*?\\ss="(\\d+)"`))?.[1];
  const xfs = styles
    .match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)![1]
    .match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)!;
  return { sheet, styles, style, xfs };
}

describe('цвет строки по потенциалу врача', () => {
  it('строка визита залита цветом потенциала, формат ячеек тот же', async () => {
    const res = await fillTemplate(await template(), [visit], [], potentials());
    const { sheet, styles, style, xfs } = await parts(res.file);

    // визит приложения лёг в строку 3 — высокий, строка файла 2 — низкий
    expect(sheet).toContain('Новикова');
    const high = Number(style('G3'));
    const low = Number(style('G2'));
    expect(high).toBeGreaterThanOrEqual(4);
    expect(low).toBeGreaterThanOrEqual(4);
    expect(high).not.toBe(low);
    // вся строка B–N одного цвета, A (день недели) — как была
    for (const c of 'BCDEFGHIJKLMN') expect(style(`${c}3`)).toBe(String(high));
    expect(style('A3')).toBe('3');
    // свободная строка не тронута
    expect(style('G4')).toBe('3');

    // копия формата 3: те же шрифт, рамка, выравнивание — другая заливка
    expect(xfs[high]).toContain('numFmtId="49" fontId="3"');
    expect(xfs[high]).toContain('<alignment wrapText="1"/>');
    const fills = styles.match(/<fill>[\s\S]*?<\/fill>/g)!;
    const greenFill = fills.findIndex((f) => f.includes(POTENTIAL_FILL.HIGH));
    expect(xfs[high]).toContain(`fillId="${greenFill}" borderId="1"`);
    expect(xfs[high]).toContain('applyFill="1"');
    expect(styles).toContain('<fills count="4">');
    expect(styles).toContain(`<fgColor rgb="${POTENTIAL_FILL.HIGH}"/>`);
    expect(styles).toContain(`<fgColor rgb="${POTENTIAL_FILL.LOW}"/>`);
    expect(styles).toContain(`<cellXfs count="${xfs.length}">`);
    // исходные форматы не изменились
    expect(xfs.slice(0, 4).join('')).toBe(
      STYLES.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)![1],
    );
  });

  it('потенциала нет — стили и строки файла не меняются', async () => {
    const res = await fillTemplate(await template(), [], [], {
      byVisit: new Map(),
      byTemplateRow: new Map(),
    });
    const { styles, style } = await parts(res.file);
    expect(styles).toBe(STYLES);
    expect(style('G2')).toBe('3');
  });

  it('предпросмотр знает потенциал строки', async () => {
    const day = await previewDay(
      await template(),
      [visit],
      '2026-10-01',
      [],
      potentials(),
    );
    const byRow = new Map(day.rows.map((r) => [r.row, r.potential]));
    expect([byRow.get(2), byRow.get(3), byRow.get(4)]).toEqual([
      'LOW',
      'HIGH',
      undefined,
    ]);
  });
});
