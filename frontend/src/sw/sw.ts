/// <reference lib="webworker" />
// Сервис-воркер: приложение открывается без сети + приём файла из «Поделиться».
// Данные API он НЕ кеширует — офлайн для визитов делает IndexedDB (src/offline).
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { kvSet } from '../offline/db';
import { SHARED_FILE_KEY, type SharedFile } from '../offline/shared';

declare const self: ServiceWorkerGlobalScope;

// оболочка приложения (html, js, css, иконки) — из кеша, обновляется сама
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.skipWaiting();
clientsClaim();

// любые адреса приложения без сети открывают index.html; /api — мимо
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/share-target/],
  }),
);

// WhatsApp → «Поделиться» → «Визиты МП»: Android присылает файл POST-запросом
// на /share-target (см. share_target в манифесте). Кладём файл в память
// телефона и открываем экран отчёта — он загрузит шаблон (или поставит в
// очередь, если сети нет).
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(receiveShare(event.request));
  }
});

async function receiveShare(request: Request) {
  try {
    const form = await request.formData();
    const file = form.getAll('file').find((f): f is File => f instanceof File);
    if (file) {
      const shared: SharedFile = {
        name: file.name,
        type: file.type,
        blob: file,
      };
      await kvSet(SHARED_FILE_KEY, shared);
    }
  } catch {
    // не смогли прочитать — просто откроем экран отчёта
  }
  return Response.redirect('/report?shared', 303);
}
