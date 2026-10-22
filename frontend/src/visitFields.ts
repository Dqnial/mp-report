// Какие поля визита не заполнены — для карточки, подсказки перед отправкой и
// фильтра. Обязательных полей нет (врач может не назвать имя, не дать телефон),
// это только чтобы было видно, чего не хватает.
import type { VisitKind } from './api/types';

interface VisitLike {
  kind: VisitKind;
  fullName: string | null;
  placeName: string | null;
  address: string | null;
  phone: string | null;
  specialty: string | null;
  products: unknown[];
  productsRaw?: string | null;
}

export type MissingField =
  'fullName' | 'placeName' | 'address' | 'phone' | 'specialty' | 'products';

/** «нет ФИО», «нет аптеки»… — как писать отсутствие поля. */
export const missingLabel = (field: MissingField, kind: VisitKind) =>
  ({
    fullName: 'ФИО',
    placeName: kind === 'PHARMACY' ? 'аптеки' : 'ЛПУ',
    address: 'адреса',
    phone: 'телефона',
    specialty: 'специальности',
    products: 'препаратов',
  })[field];

/** Как назвать поле в сводке: «без ФИО — 2». */
export const fieldName = (field: MissingField) =>
  ({
    fullName: 'ФИО',
    placeName: 'ЛПУ / аптеки',
    address: 'адреса',
    phone: 'телефона',
    specialty: 'специальности',
    products: 'препаратов',
  })[field];

const blank = (s: string | null | undefined) => !s?.trim();

export function missingFields(v: VisitLike): MissingField[] {
  const out: MissingField[] = [];
  if (blank(v.fullName)) out.push('fullName');
  if (blank(v.placeName)) out.push('placeName');
  if (blank(v.address)) out.push('address');
  if (blank(v.phone)) out.push('phone');
  if (blank(v.specialty)) out.push('specialty');
  if (!v.products.length && blank(v.productsRaw)) out.push('products');
  return out;
}
