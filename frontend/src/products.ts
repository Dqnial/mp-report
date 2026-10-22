// Совпадает с backend/src/products.ts — коды уходят на сервер, short — на кнопки.
export const PRODUCTS = [
  { code: 'COF_YOGUE', label: 'Коф Йог', short: 'Коф' },
  { code: 'WORMZWIN', label: 'Вормзвин', short: 'Ворм' },
  { code: 'TRIPHALA', label: 'Трифала', short: 'Триф' },
  { code: 'LAXSID', label: 'Лаксид', short: 'Лакс' },
  { code: 'TURMERIC', label: 'Куркума', short: 'Курк' },
  { code: 'CALCIACTIV', label: 'Кальциактив', short: 'Кальц' },
] as const;

const BY_CODE = new Map<string, (typeof PRODUCTS)[number]>(
  PRODUCTS.map((p) => [p.code, p]),
);

export const productLabel = (code: string) => BY_CODE.get(code)?.label ?? code;

/**
 * Как в отчёте (backend/src/products.ts): «Коф Йог», «Коф Йог 9» (только
 * остаток) или «Коф Йог: ост. 5, прод. 3, заказ 10».
 */
export function productText(p: {
  code: string;
  stock?: number;
  sold?: number;
  order?: number;
}) {
  const label = productLabel(p.code);
  const parts = [
    p.stock != null && `ост. ${p.stock}`,
    p.sold != null && `прод. ${p.sold}`,
    p.order != null && `заказ ${p.order}`,
  ].filter(Boolean);
  if (!parts.length) return label;
  if (parts.length === 1 && p.stock != null) return `${label} ${p.stock}`;
  return `${label}: ${parts.join(', ')}`;
}

/** Частые фразы комментария из реальных отчётов — вставляются одним нажатием. */
export const COMMENT_PHRASES = {
  DOCTOR: ['посмотрит', 'попробует назначить', 'обещал(а) выписывать', 'подумает', 'уже выписывает'],
  PHARMACY: ['обещала дозаказать', 'по спросу', 'заявка через офис', 'всё есть', 'сами продают'],
} as const;

/** Быстрые ответы для «факт выполнения» и «отклонение». */
export const FACT_PHRASES = {
  DOCTOR: ['выписывает', 'выписал(а) 1–2 раза', 'не выписывал(а)'],
  PHARMACY: ['дозаказали', 'дозаказали частично', 'не дозаказали'],
} as const;
export const DEVIATION_PHRASES = {
  DOCTOR: ['нет', 'нет в аптеках', 'нет пациентов', 'дорого для пациентов'],
  PHARMACY: ['нет', 'нет спроса', 'заявка через офис', 'склад не привёз'],
} as const;

export const SPECIALTIES = {
  DOCTOR: ['ВОП', 'педиатр', 'терапевт', 'гинеколог', 'лор', 'гастроэнтеролог', 'эндокринолог', 'хирург', 'невролог', 'кардиолог'],
  PHARMACY: ['провизор', 'фармацевт', 'зав. аптекой'],
} as const;
