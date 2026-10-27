// HTML страницы с тегами под её адрес (серверная подстановка до запуска JS): какие запросы она затрагивает,
// что подставляется в <link rel="manifest">, <title> и apple-mobile-web-app-title, и что таблица разделов
// не разошлась с сайдбаром фронта.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'sp-page-'))
process.env.DATA_DIR = dir
process.env.STATIC_DIR = dir

// Разметка повторяет frontend/index.html (отдельно, ниже, проверяется и настоящий собранный файл)
const INDEX = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/images/icon.svg" />
    <link rel="apple-touch-icon" href="/images/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <title>Mac Mini — панель сервера</title>
    <meta name="description" content="Панель администрирования домашнего сервера" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Mac Mini" />
    <meta name="theme-color" content="#0f172a" media="(prefers-color-scheme: dark)" />
  </head>
  <body><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></body>
</html>
`
writeFileSync(path.join(dir, 'index.html'), INDEX)

const { PAGE_NAMES, PANEL_NAME, injectPageTags, isPageRequest, pageName, renderPage, splitUrl } = await import('./pageHtml.js')

// Значения трёх подставляемых тегов из готового HTML
function tags(html: string) {
  const manifest = /<link\b[^>]*\brel="manifest"[^>]*\bhref="([^"]*)"/i.exec(html)?.[1]
  const q = new URLSearchParams((manifest ?? '').replace(/&amp;/g, '&').split('?')[1] ?? '')
  return {
    href: manifest,
    start: q.get('start'),
    manifestName: q.get('name'),
    title: /<title>([^<]*)<\/title>/i.exec(html)?.[1],
    appleTitle: /<meta\b[^>]*\bname="apple-mobile-web-app-title"[^>]*\bcontent="([^"]*)"/i.exec(html)?.[1],
  }
}

describe('isPageRequest: что собирается на сервере', () => {
  const html = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  it('страницы панели — да', () => {
    for (const url of ['/', '/index.html', '/disks', '/media-control?tab=universal', '/tv/system', '/sign-in?redirect=%2Fdisks'])
      assert.equal(isPageRequest('GET', url, html), true, url)
  })
  it('файлы, API, не-GET и запросы не за HTML — нет', () => {
    for (const url of ['/api/system/overview', '/assets/index-abc.js', '/manifest.webmanifest?start=%2Fdisks', '/offline.html', '/sw.js', '/images/icon-192.png'])
      assert.equal(isPageRequest('GET', url, html), false, url)
    assert.equal(isPageRequest('POST', '/disks', html), false)
    assert.equal(isPageRequest('GET', '/disks', 'application/json'), false)
    assert.equal(isPageRequest('GET', '/disks', undefined), false)
    assert.equal(isPageRequest('GET', '/disks', '*/*'), true) // curl и скрипты получают ту же страницу
  })
})

describe('pageName: имя страницы по адресу', () => {
  it('разделы сайдбара', () => {
    assert.equal(pageName('/', ''), 'Обзор')
    assert.equal(pageName('/disks', ''), 'Диски')
    assert.equal(pageName('/network', '?scan=1'), 'Сеть и устройства')
    assert.equal(pageName('/errors/404', ''), PANEL_NAME)
  })
  it('«Медиа»: универсальный пульт — «Пульт», прочие вкладки — заголовок страницы', () => {
    assert.equal(pageName('/media-control', '?tab=universal'), 'Пульт')
    assert.equal(pageName('/media-control', ''), 'Пульт')
    assert.equal(pageName('/media-control', '?tab=samsung'), 'Медиа')
  })
  it('вход, ТВ-режим и неизвестные пути — имя панели', () => {
    for (const p of ['/sign-in', '/tv', '/tv/system', '/404', '/чего-то-нет']) assert.equal(pageName(p, ''), PANEL_NAME, p)
  })
})

describe('injectPageTags: подстановка в HTML', () => {
  it('меняет ровно три тега, остальное не трогает', () => {
    const out = injectPageTags(INDEX, '/disks', 'Диски')
    const t = tags(out)
    assert.equal(t.start, '/disks')
    assert.equal(t.manifestName, 'Диски')
    assert.equal(t.title, 'Диски')
    assert.equal(t.appleTitle, 'Диски')
    // «&» в атрибуте экранирован, apple-touch-icon, иконки, описание и цвета на месте
    assert.match(t.href!, /^\/manifest\.webmanifest\?start=[^&]*&amp;name=/)
    assert.ok(out.includes('<link rel="apple-touch-icon" href="/images/apple-touch-icon.png" />'))
    assert.ok(out.includes('<link rel="icon" type="image/svg+xml" href="/images/icon.svg" />'))
    assert.ok(out.includes('content="Панель администрирования домашнего сервера"'))
    assert.ok(out.includes('<meta name="apple-mobile-web-app-capable" content="yes" />'))
    assert.ok(out.includes('/assets/index-abc.js'))
  })
  it('опасные символы в имени не ломают разметку', () => {
    const t = tags(injectPageTags(INDEX, '/disks', 'Ди"с<ки&'))
    assert.equal(t.title, 'Ди&quot;с&lt;ки&amp;')
    assert.equal(t.appleTitle, 'Ди&quot;с&lt;ки&amp;')
    assert.equal(t.manifestName, 'Ди"с<ки&') // в query — процентное кодирование, в атрибуте «&» экранирован
  })
})

describe('renderPage: HTML под адрес запроса', () => {
  it('страница раздела с параметрами', () => {
    const t = tags(renderPage('/media-control?tab=universal')!)
    assert.equal(t.start, '/media-control?tab=universal')
    assert.equal(t.manifestName, 'Пульт')
    assert.equal(t.title, 'Пульт')
    assert.equal(t.appleTitle, 'Пульт')
  })
  it('обычное открытие панели без параметров — как было: «/» и «Обзор»', () => {
    const t = tags(renderPage('/')!)
    assert.equal(t.start, '/')
    assert.equal(t.title, 'Обзор')
  })
  it('вход и неизвестный путь: имя по умолчанию, адрес свой', () => {
    const signIn = tags(renderPage('/sign-in?redirect=%2Fdisks')!)
    assert.equal(signIn.start, '/sign-in?redirect=%2Fdisks')
    assert.equal(signIn.title, PANEL_NAME)
    assert.equal(tags(renderPage('/чего-то-нет')!).title, PANEL_NAME)
  })
  it('мусорный адрес не уходит в start_url', () => {
    assert.equal(tags(renderPage('//evil.com')!).start, '/')
    assert.equal(tags(renderPage('/\\evil.com')!).start, '/')
    assert.equal(tags(renderPage('/' + 'a'.repeat(300))!).start, '/')
  })
  it('настоящий собранный index.html: все три тега заменяются', () => {
    const real = path.resolve(import.meta.dirname, '..', '..', 'frontend', 'dist', 'index.html')
    if (!existsSync(real)) return // фронт не собран — проверять нечего
    const t = tags(injectPageTags(readFileSync(real, 'utf8'), '/disks', 'Диски'))
    assert.equal(t.start, '/disks')
    assert.equal(t.title, 'Диски')
    assert.equal(t.appleTitle, 'Диски')
  })
})

describe('PAGE_NAMES: копия разделов сайдбара', () => {
  it('совпадает с frontend/src/components/layout/data/sidebar-data.ts', () => {
    const file = path.resolve(import.meta.dirname, '..', '..', 'frontend', 'src', 'components', 'layout', 'data', 'sidebar-data.ts')
    if (!existsSync(file)) return
    const src = readFileSync(file, 'utf8')
    const front = [...src.matchAll(/\{\s*title:\s*'([^']+)',\s*url:\s*'([^']+)'/g)].map(([, title, url]) => [url, title])
    assert.ok(front.length > 10, 'разбор сайдбара сломался')
    const map = new Map(PAGE_NAMES)
    for (const [url, title] of front) assert.equal(map.get(url), title, `раздел ${url}`)
    assert.equal(map.size, front.length, 'в PAGE_NAMES есть лишние адреса')
  })
})

describe('splitUrl', () => {
  it('делит адрес на путь и параметры', () => {
    assert.deepEqual(splitUrl('/disks'), { pathname: '/disks', search: '' })
    assert.deepEqual(splitUrl('/media-control?tab=samsung'), { pathname: '/media-control', search: '?tab=samsung' })
  })
})

// Порядок важен: хук стоит до @fastify/static, иначе «/» и «/index.html» отдавались бы файлом как раньше
describe('хук страниц рядом со статикой', () => {
  const html = 'text/html,*/*;q=0.8'
  it('страницы собираются хуком, файлы отдаёт статика', async () => {
    writeFileSync(path.join(dir, 'assets-app.js'), 'console.log(1)\n')
    const { default: Fastify } = await import('fastify')
    const { default: fastifyStatic } = await import('@fastify/static')
    const app = Fastify()
    app.addHook('onRequest', async (req, reply) => {
      if (!isPageRequest(req.method, req.url, req.headers.accept)) return
      const out = renderPage(req.url)
      if (out === undefined) return
      return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(out)
    })
    await app.register(fastifyStatic, { root: dir, wildcard: true })

    // «/» статика отдала бы файлом — но хук успевает раньше и подставляет теги
    const root = await app.inject({ method: 'GET', url: '/', headers: { accept: html } })
    assert.equal(root.statusCode, 200)
    assert.match(root.headers['content-type'] as string, /text\/html/)
    assert.equal(root.headers['cache-control'], 'no-cache')
    assert.equal(tags(root.body).title, 'Обзор')

    // путь без файла на диске: раньше был бы 404 от статики
    const page = await app.inject({ method: 'GET', url: '/media-control?tab=universal', headers: { accept: html } })
    assert.equal(page.statusCode, 200)
    assert.equal(tags(page.body).title, 'Пульт')
    assert.equal(tags(page.body).start, '/media-control?tab=universal')

    // файл с хэшем в имени хук не трогает
    const asset = await app.inject({ method: 'GET', url: '/assets-app.js', headers: { accept: html } })
    assert.equal(asset.statusCode, 200)
    assert.equal(asset.body, 'console.log(1)\n')
    await app.close()
  })
})
