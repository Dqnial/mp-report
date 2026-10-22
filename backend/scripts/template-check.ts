// Как приложение видит шаблон: npm run template:check -- <файл.xlsx>
// Печатает дни, план (ЛПУ × строк, занято) и что будет импортировано.
// ФИО, телефоны и адреса не выводит.
import { readFileSync } from 'node:fs';
import { placeDay, readFilledRows } from '../src/report/xlsx-template';
import { rowToVisit } from '../src/templates/row-import';

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Использование: npm run template:check -- <файл.xlsx>');
    process.exit(1);
  }
  const info = await readFilledRows(readFileSync(path));
  console.log(
    `Лист: «${info.sheetName}», месяц ${info.month}, дней: ${info.days.length}`,
  );
  for (const d of info.days) {
    const numbered = d.slots.filter((s) => s.numbered).length;
    const free = d.slots.filter((s) => s.free).length;
    console.log(
      `
${d.date}  строки ${d.firstRow}–${d.lastRow}  слотов ${numbered}` +
        ` (+${d.slots.length - numbered} без номера)  свободно ${free}`,
    );
    for (const g of placeDay(d, []).groups) {
      console.log(`    ${g.row}  ${g.place}  — ${g.used}/${g.capacity}`);
    }
  }

  const visits = info.filled.map(rowToVisit);
  const doctors = visits.filter((v) => v.kind === 'DOCTOR').length;
  const withProducts = visits.filter((v) => v.products.length).length;
  console.log(
    `\nИмпорт: ${visits.length} визитов (врачи ${doctors}, аптеки ${visits.length - doctors}),` +
      ` с распознанными препаратами ${withProducts}`,
  );
  // строки, где в J–M что-то есть, а препаратов не нашли, — проверить глазами
  const unrecognized = visits.filter(
    (v) => v.productsRaw && !v.products.length,
  );
  if (unrecognized.length) {
    console.log('Препараты не распознаны (J–M как есть):');
    for (const v of unrecognized) {
      console.log(`  ${v.date} строка ${v.templateRow}: ${v.productsRaw}`);
    }
  }
}

void main();
