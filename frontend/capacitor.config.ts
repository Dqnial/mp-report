import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android-обёртка (APK). Внутри — тот же сайт: приложение открывает рабочий
 * сервер, поэтому любой git push сразу виден и в APK, переустанавливать не
 * нужно. Обёртка нужна ради «Поделиться» с файлами: Chrome на Android не даёт
 * делиться .xlsx (его список разрешённых типов), а нативное приложение — даёт.
 *
 * Адрес сервера — только из APP_URL при сборке (в CI — переменная репозитория
 * APP_DOMAIN), в коде его нет. Локально: APP_URL=https://… npx cap sync android.
 * Сменили домен → пересобрать APK.
 */
const serverUrl = process.env.APP_URL;
if (!serverUrl) {
  throw new Error('APP_URL не задан: адрес сайта для Android-приложения');
}

const config: CapacitorConfig = {
  appId: 'kz.vizity.mpreport',
  appName: 'Визиты',
  // запасные файлы внутри APK (если сервер недоступен при самом первом запуске);
  // в работе приложение берёт всё с сервера и кеширует сервис-воркером
  webDir: 'dist',
  server: {
    url: serverUrl,
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
