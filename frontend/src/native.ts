// Возможности Android-обёртки (APK на Capacitor). В браузере и PWA на iPhone
// этих функций нет — там работает обычный Web Share (isNative === false).
import { App } from '@capacitor/app';
import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** Приложение открыто внутри нашего APK, а не в браузере. */
export const isNative = Capacitor.isNativePlatform();

const isCancel = (e: unknown) =>
  /cancel/i.test((e as Error)?.message ?? String(e));

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * «Поделиться» файлом через Android. Chrome не даёт делиться .xlsx, а
 * приложение — может: кладём файл во временную папку ровно под его именем и
 * открываем системное меню. Имя у получателя (WhatsApp) — исходное.
 * Закрыли меню — не ошибка (возвращает false).
 */
export async function nativeShareFile(file: File, title: string) {
  const { uri } = await Filesystem.writeFile({
    path: file.name,
    data: await blobToBase64(file),
    directory: Directory.Cache,
  });
  try {
    await Share.share({ files: [uri], dialogTitle: title });
    return true;
  } catch (e) {
    if (isCancel(e)) return false;
    throw e;
  }
}

/** «Поделиться» текстом (ссылка-приглашение): в WebView нет navigator.share. */
export async function nativeShareText(text: string, title: string) {
  try {
    await Share.share({ text, dialogTitle: title });
  } catch (e) {
    if (!isCancel(e)) throw e;
  }
}

// ─── шаблон из WhatsApp → «Поделиться» → «Визиты» ──────────────────────────

interface PendingShared {
  name?: string;
  type?: string;
  base64?: string;
  error?: string;
}

interface SharedFilePlugin {
  takePending(): Promise<{ file: PendingShared | null }>;
  addListener(
    event: 'sharedFile',
    cb: () => void,
  ): Promise<PluginListenerHandle>;
}

const SharedFile = registerPlugin<SharedFilePlugin>('SharedFile');

function toFile({ name = 'file.xlsx', type, base64 = '' }: PendingShared) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type: type || 'application/octet-stream' });
}

/**
 * Принимать присланные файлы: и тот, с которым приложение запустили, и
 * присланные, пока оно открыто. Возвращает функцию отписки.
 */
export function listenSharedFiles(
  onFile: (file: File) => void,
  onError: (message: string) => void,
) {
  if (!isNative) return () => {};
  const take = async () => {
    const { file } = await SharedFile.takePending();
    if (!file) return;
    if (file.error) onError(file.error);
    else onFile(toFile(file));
  };
  void take();
  const handle = SharedFile.addListener('sharedFile', () => void take());
  return () => void handle.then((h) => h.remove());
}

/**
 * Системная «Назад»: шаг назад по экранам приложения, а с первого экрана —
 * свернуть (не закрывать: очередь отправки и состояние остаются).
 */
export function handleBackButton() {
  if (!isNative) return () => {};
  const handle = App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.minimizeApp();
  });
  return () => void handle.then((h) => h.remove());
}
