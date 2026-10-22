/** Препараты, с которыми работает МП. label — как их пишут в отчёте. */
export const PRODUCTS = [
  { code: 'COF_YOGUE', label: 'Коф Йог' },
  { code: 'WORMZWIN', label: 'Вормзвин' },
  { code: 'TRIPHALA', label: 'Трифала' },
  { code: 'LAXSID', label: 'Лаксид' },
  { code: 'TURMERIC', label: 'Куркума' },
  { code: 'CALCIACTIV', label: 'Кальциактив' },
] as const;

export type ProductCode = (typeof PRODUCTS)[number]['code'];

export const PRODUCT_CODES = PRODUCTS.map((p) => p.code);

export interface VisitProduct {
  code: ProductCode;
  /** аптека: остаток, уп. */
  stock?: number;
  /** аптека: продали с прошлого визита, уп. */
  sold?: number;
  /** аптека: сколько дозакажут, уп. */
  order?: number;
}

const LABELS = new Map<string, string>(PRODUCTS.map((p) => [p.code, p.label]));

/**
 * Текст препарата для ячейки J–M, как пишут в отчёте:
 * «Коф Йог», только остаток — «Коф Йог 9» (его привычный вид),
 * больше данных — «Коф Йог: ост. 5, прод. 3, заказ 10».
 */
export function productCellText(p: VisitProduct) {
  const label = LABELS.get(p.code) ?? p.code;
  const parts = [
    p.stock != null && `ост. ${p.stock}`,
    p.sold != null && `прод. ${p.sold}`,
    p.order != null && `заказ ${p.order}`,
  ].filter(Boolean);
  if (!parts.length) return label;
  if (parts.length === 1 && p.stock != null) return `${label} ${p.stock}`;
  return `${label}: ${parts.join(', ')}`;
}

/** Колонок под препараты в шаблоне четыре (J–M). */
export const PRODUCT_COLUMNS = 4;

/**
 * Препараты визита → тексты для J–M. Больше четырёх — остальные дописываем
 * в последнюю ячейку через запятую (так делают и вручную).
 */
export function productCells(products: VisitProduct[]): string[] {
  const texts = products.map(productCellText);
  if (texts.length <= PRODUCT_COLUMNS) return texts;
  const head = texts.slice(0, PRODUCT_COLUMNS - 1);
  return [...head, texts.slice(PRODUCT_COLUMNS - 1).join(', ')];
}
