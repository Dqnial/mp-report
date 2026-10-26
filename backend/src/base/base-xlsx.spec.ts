import JSZip from 'jszip';
import { TemplateFormatError } from '../xlsx/xlsx-xml';
import { analyzeBase, fillBase, type BaseRecord } from './base-xlsx';

/**
 * Мини-база как у руководителя: скрытый лист со сводкой, «База врачей»
 * (шапка во 2-й строке, 3 подготовленные строки с № и строкой-примером,
 * справочная табличка в L, фильтр и подсветка повторов ФИО) и «База аптек»
 * (шапка в 1-й строке, строки без номеров).
 */
const t = (ref: string, s: number, text?: string) =>
  text
    ? `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${text}</t></is></c>`
    : `<c r="${ref}" s="${s}"/>`;

const DOCTOR_HEAD = [
  '№',
  'МП ',
  'Город Алматы',
  'ФИО  Врача',
  'Специальность',
  'Сот телефон ',
  'ЛПУ',
  'адрес',
  'Препарата',
  'Патенциаль',
];
const COLS = 'ABCDEFGHIJ';

function doctorRow(r: number, n: number, example?: string[]) {
  return (
    `<row r="${r}" spans="1:12">` +
    [...COLS]
      .map((c, i) => t(`${c}${r}`, 5, i === 0 ? String(n) : example?.[i]))
      .join('') +
    (r === 3 ? t(`L${r}`, 6, 'Справка') : '') +
    `</row>`
  );
}

const SUMMARY_SHEET =
  '<worksheet><sheetData><row r="1"><c r="A1"><f>B1+C1</f><v>3</v></c></row></sheetData></worksheet>';

async function base() {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  );
  zip.file(
    'xl/workbook.xml',
    '<workbook><sheets>' +
      '<sheet name="Coverage" sheetId="5" state="hidden" r:id="rId1"/>' +
      '<sheet name="База врачей" sheetId="4" r:id="rId2"/>' +
      '<sheet name="База аптек" sheetId="6" r:id="rId3"/>' +
      '</sheets></workbook>',
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships>' +
      '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId3" Target="worksheets/sheet3.xml"/>' +
      '</Relationships>',
  );
  zip.file('xl/worksheets/sheet1.xml', SUMMARY_SHEET);
  zip.file(
    'xl/worksheets/sheet2.xml',
    '<worksheet><dimension ref="A2:L5"/><sheetData>' +
      `<row r="2">${[...COLS].map((c, i) => t(`${c}2`, 4, DOCTOR_HEAD[i])).join('')}</row>` +
      doctorRow(3, 1, [
        '',
        'Пример Представитель',
        'Алматы',
        'Образцова Ольга Петровна',
        'ВОП',
        '87000000000',
        'ГП Пример',
        'Примерная 1',
        'Лаксид',
        'Средний',
      ]) +
      doctorRow(4, 2) +
      doctorRow(5, 3) +
      '</sheetData><autoFilter ref="A2:J5"/>' +
      '<conditionalFormatting sqref="D1:D5 D40:D100"><cfRule type="duplicateValues" dxfId="0" priority="1"/></conditionalFormatting>' +
      '</worksheet>',
  );
  zip.file(
    'xl/worksheets/sheet3.xml',
    '<worksheet><dimension ref="A1:F4"/><sheetData>' +
      `<row r="1">${[
        '№',
        'ФИО  провизора',
        'Специальность',
        'Сот телефон ',
        'Аптека',
        'Адрес',
      ]
        .map((h, i) => t(`${'ABCDEF'[i]}1`, 4, h))
        .join('')}</row>` +
      [2, 3, 4]
        .map(
          (r) =>
            `<row r="${r}">${[...'ABCDEF'].map((c) => t(`${c}${r}`, 7)).join('')}</row>`,
        )
        .join('') +
      '</sheetData></worksheet>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Лист как {строка: {колонка: значение}} и стили ячеек. */
async function readSheet(file: Buffer, n: number) {
  const zip = await JSZip.loadAsync(file);
  const xml = await zip.file(`xl/worksheets/sheet${n}.xml`)!.async('string');
  const values: Record<number, Record<string, string>> = {};
  const styles: Record<string, string> = {};
  for (const [, col, r, attrs, inner] of xml.matchAll(
    /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
  )) {
    styles[`${col}${r}`] = attrs.match(/s="(\d+)"/)?.[1] ?? '';
    const v = inner?.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
    if (v) (values[Number(r)] ??= {})[col] = v;
  }
  return { xml, values, styles };
}

const doctor = (i: number): BaseRecord => ({
  fullName: `Врачова${'абвгд'[i]} Анна`,
  specialty: 'ВОП',
  phone: `8700111000${i}`,
  place: 'ГП 1',
  address: 'Тестовая 5',
  products: 'Лаксид, Коф Йог',
});

describe('база врачей и аптек', () => {
  it('находит листы врачей и аптек по заголовкам', async () => {
    expect(await analyzeBase(await base())).toEqual({
      doctors: { sheet: 'База врачей' },
      pharmacies: { sheet: 'База аптек' },
    });
  });

  it('файл без листов базы — понятная ошибка', async () => {
    const zip = await JSZip.loadAsync(await base());
    zip.remove('xl/worksheets/sheet2.xml');
    zip.remove('xl/worksheets/sheet3.xml');
    const file = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(analyzeBase(file)).rejects.toThrow(TemplateFormatError);
  });

  it('врачей больше подготовленных строк: дописывает ниже, нумерация и таблица продолжаются', async () => {
    const res = await fillBase(await base(), {
      mp: 'Тестов Тест',
      doctors: [0, 1, 2, 3, 4].map(doctor),
      pharmacies: [],
    });
    expect(res.doctors).toBe(5);
    const { xml, values, styles } = await readSheet(res.file, 2);

    // строка-пример руководителя заменена, «Потенциал» пустой, город из шапки
    expect(values[3]).toEqual({
      A: '1',
      B: 'Тестов Тест',
      C: 'Алматы',
      D: 'Врачоваа Анна',
      E: 'ВОП',
      F: '87001110000',
      G: 'ГП 1',
      H: 'Тестовая 5',
      I: 'Лаксид, Коф Йог',
      L: 'Справка', // справочная табличка сбоку не тронута
    });
    expect(values[7]).toMatchObject({ A: '5', D: 'Врачовад Анна' });
    // новые строки — с оформлением строки выше
    expect(styles.D6).toBe('5');
    expect(styles.J7).toBe('5');
    // фильтр и подсветка повторов ФИО растянуты на новых врачей
    expect(xml).toContain('<autoFilter ref="A2:J7"/>');
    expect(xml).toContain('sqref="D1:D7 D40:D100"');
    expect(xml).toContain('<dimension ref="A2:L7"/>');
    // строки идут по порядку
    const order = [...xml.matchAll(/<row r="(\d+)"/g)].map((m) => +m[1]);
    expect(order).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('врачей меньше строк: пример ниже стирается, подготовленная нумерация остаётся', async () => {
    const res = await fillBase(await base(), {
      mp: 'Тестов Тест',
      doctors: [],
      pharmacies: [],
    });
    const { values } = await readSheet(res.file, 2);
    expect(values[3]).toEqual({ A: '1', L: 'Справка' });
    expect(values[5]).toEqual({ A: '3' });
  });

  it('аптеки: свой лист, без колонки препаратов; остальная книга не меняется', async () => {
    const original = await base();
    const res = await fillBase(original, {
      mp: 'Тестов Тест',
      doctors: [],
      pharmacies: [
        {
          fullName: 'Айгуль',
          specialty: 'провизор',
          phone: '87002220000',
          place: 'Аптека «Здоровье» & K°',
          address: 'Тестовая 7',
        },
        { place: 'Аптека без провизора', address: '<угол>' },
      ],
    });
    expect(res.pharmacies).toBe(2);
    const { values, styles } = await readSheet(res.file, 3);
    expect(values[2]).toEqual({
      A: '1',
      B: 'Айгуль',
      C: 'провизор',
      D: '87002220000',
      E: 'Аптека «Здоровье» &amp; K°',
      F: 'Тестовая 7',
    });
    expect(values[3]).toEqual({
      A: '2',
      E: 'Аптека без провизора',
      F: '&lt;угол&gt;',
    });
    expect(styles.B2).toBe('7');

    const before = await JSZip.loadAsync(original);
    const after = await JSZip.loadAsync(res.file);
    for (const part of ['xl/workbook.xml', 'xl/worksheets/sheet1.xml']) {
      expect(await after.file(part)!.async('string')).toBe(
        await before.file(part)!.async('string'),
      );
    }
  });
});
