import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// куда проксировать /api при разработке: по умолчанию локальный бэкенд,
// API_TARGET=https://… — рабочий сервер (если локальная база не запущена)
const API_TARGET = process.env.API_TARGET ?? 'http://localhost:3000'
const apiProxy = {
  '/api': { target: API_TARGET, changeOrigin: true, secure: true },
}

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // свой сервис-воркер (src/sw/sw.ts): нужен приём файлов из «Поделиться»
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      // woff2 — шрифт тоже кешируется, иначе без сети откатится на системный
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'] },
      manifest: {
        name: 'Визиты МП',
        short_name: 'Визиты',
        description: 'Визиты к врачам и в аптеки, отчёт в один клик',
        lang: 'ru',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0b7285',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
        // WhatsApp → файл → «Поделиться» → «Визиты МП» (только Android Chrome, по HTTPS)
        share_target: {
          action: '/share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [{ name: 'file', accept: [XLSX_MIME, '.xlsx'] }],
          },
        },
      },
    }),
  ],
  server: {
    // фронт и API на одном origin — как на проде; иначе SameSite-куки не пойдут
    host: true,
    proxy: apiProxy,
  },
  // vite preview (проверка собранного PWA с сервис-воркером) — тот же прокси
  preview: {
    host: true,
    proxy: apiProxy,
  },
})
