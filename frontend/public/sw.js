// Service worker панели: делает её устанавливаемой и показывает офлайн-заглушку.
// Данные не кешируются: /api/* и страницы всегда идут в сеть. Кеш — только оболочка (хэшированная статика, иконки, заглушка)
// и копии уже открытых страниц под их собственными адресами — на случай обрыва связи.
// Обновление: при изменении этого файла (поднимите VERSION) браузер ставит новый SW, он сразу активируется (skipWaiting + claim),
// кеши с другим именем удаляются в activate. Страница всегда сначала запрашивается из сети, поэтому после деплоя она свежая.
const VERSION = 'v2'
const CACHE = `panel-shell-${VERSION}`
const OFFLINE = '/offline.html'
// Манифест в оболочку не кладём: он динамический (/manifest.webmanifest?start=…), на страницу свой, и из кеша не отдаётся
const SHELL = [OFFLINE, '/images/icon-192.png']

self.addEventListener('install', (e) => {
  // skipWaiting — новый SW не ждёт закрытия вкладок
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  // Кеши прошлых версий удаляются, clients.claim — новый SW управляет уже открытыми страницами сразу
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

  // Переходы по страницам: сначала сеть по запрошенному адресу, удачный ответ кладём в кеш под этим же адресом
  // (с параметрами). При обрыве связи отдаём сохранённую копию ИМЕННО этой страницы, а если её нет — офлайн-заглушку.
  // Подменять открытый адрес кешированной «/» нельзя: иконка с экрана «Домой» запускает панель по своему start_url
  // (например /media-control?tab=universal), и этот адрес должен дойти до приложения.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)))
          }
          return res
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match(OFFLINE)))
    )
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
