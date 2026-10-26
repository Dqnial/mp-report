import type { BaseUploaded } from './api/types';

/** Что нашлось в загруженном файле — коротко для уведомления. */
export function baseUploadedMessage(b: BaseUploaded) {
  const { doctors, pharmacies } = b.sheets;
  if (doctors && pharmacies) return 'Нашёл листы врачей и аптек';
  return doctors
    ? 'Нашёл только лист врачей — аптеки в базу не попадут'
    : 'Нашёл только лист аптек — врачи в базу не попадут';
}
