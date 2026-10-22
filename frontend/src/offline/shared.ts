// Файл, присланный через «Поделиться» (Share Target). Сервис-воркер кладёт
// его в память телефона и открывает /report?shared, а экран забирает отсюда.
import { kvDelete, kvGet } from './db';

export const SHARED_FILE_KEY = 'shared-file';

export interface SharedFile {
  name: string;
  type: string;
  blob: Blob;
}

/** Забрать присланный файл (один раз). */
export async function takeSharedFile() {
  const shared = await kvGet<SharedFile>(SHARED_FILE_KEY);
  if (!shared) return null;
  await kvDelete(SHARED_FILE_KEY);
  return new File([shared.blob], shared.name, { type: shared.type });
}
