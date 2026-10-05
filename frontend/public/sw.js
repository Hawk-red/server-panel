// Service worker панели: делает её устанавливаемой и показывает офлайн-заглушку.
// Данные не кешируются: /api/* и страницы всегда идут в сеть. Кеш — только оболочка (хэшированная статика, иконки, заглушка).
// Обновление: при изменении этого файла (поднимите VERSION) браузер ставит новый SW, он сразу активируется (skipWaiting + claim),
// старые кеши удаляются. Страница (index.html) в кеш не попадает, поэтому после деплоя всегда грузится свежая.
const VERSION = 'v1'
const CACHE = `panel-shell-${VERSION}`
const SHELL = ['/offline.html', '/images/icon-192.png', '/manifest.webmanifest']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('panel-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return // API и чужое — мимо SW, всегда сеть

  // Переходы по страницам: сеть; если панели нет — заглушка
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')))
    return
  }
  // Хэшированная статика: имя файла меняется с каждой сборкой, поэтому кеш-first безопасен
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          })
      )
    )
  }
})
