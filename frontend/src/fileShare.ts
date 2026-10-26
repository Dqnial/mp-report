// Готовый xlsx (отчёт, база) — в WhatsApp через «Поделиться» или в «Загрузки».
import { notifications } from '@mantine/notifications';
import { isNative, nativeShareFile } from './native';

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Скачать в «Загрузки» — только по явному нажатию (иначе мусор и «(1)» в имени). */
export function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: file.name,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  notifications.show({
    color: 'teal',
    message: 'Файл скачан — его можно отправить из «Загрузок»',
  });
}

/**
 * «Поделиться» → WhatsApp. Файл живёт только в памяти страницы — на устройство
 * ничего не сохраняется, имя уходит ровно исходное. share вызываем сразу в
 * обработчике нажатия (файл подготовлен заранее): иначе браузер отказывает
 * «Permission denied». Отказал всё равно — сообщаем, но сами не скачиваем.
 */
export function shareFile(file: File, title: string, onFail: () => void) {
  // Android-приложение (APK): системное «Поделиться» умеет .xlsx, Chrome — нет
  if (isNative) {
    nativeShareFile(file, title).catch(onFail);
    return;
  }
  if (!navigator.canShare?.({ files: [file] })) return onFail();
  navigator.share({ files: [file] }).catch((e: Error) => {
    if (e.name === 'AbortError') return; // закрыл меню «Поделиться»
    onFail();
  });
}
