// Манифест PWA по адресу страницы (GET /manifest.webmanifest?start=…&name=…): проверка start (внешние адреса
// и мусор → «/»), id/start_url в ответе, доступ без входа, обработка имени.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'sp-manifest-'))
process.env.DATA_DIR = dir
process.env.STATIC_DIR = dir
writeFileSync(
  path.join(dir, 'manifest.webmanifest'),
  JSON.stringify({
    id: '/',
    name: 'Mac Mini — панель сервера',
    short_name: 'Mac Mini',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: '#0f172a',
    icons: [{ src: '/images/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }],
  })
)

const { default: Fastify } = await import('fastify')
const { MANIFEST_PATH, buildManifest, manifestFor, safeName, safeStart } = await import('./manifest.js')
const { PUBLIC_PATHS, requireAuth } = await import('./auth.js')
const { manifestRoutes } = await import('./routes/manifest.js')

// Маршрут стоит за requireAuth: так проверяется именно исключение в auth, а не отсутствие хука
const app = Fastify()
await app.register(async (a) => {
  a.addHook('preHandler', requireAuth)
  await manifestRoutes(a)
})
app.decorateRequest('clientIp', '')

type Manifest = Record<string, unknown>
const get = async (query = '') => {
  const res = await app.inject({ method: 'GET', url: MANIFEST_PATH + query })
  return { res, body: res.statusCode === 200 ? (JSON.parse(res.body) as Manifest) : ({} as Manifest) }
}

describe('safeStart: start только внутренний путь панели', () => {
  it('пропускает путь панели с параметрами', () => {
    assert.equal(safeStart('/disks'), '/disks')
    assert.equal(safeStart('/media-control?tab=universal'), '/media-control?tab=universal')
    assert.equal(safeStart('/'), '/')
  })
  it('внешние адреса и мусор заменяет на «/»', () => {
    for (const bad of [
      'https://evil.com',
      'http://evil.com/disks',
      '//evil.com',
      '/\\evil.com',
      '/\t/evil.com',
      '/disks\n',
      'javascript:alert(1)',
      'disks',
      '',
      '/' + 'a'.repeat(200), // 201 символ
      undefined,
      null,
      42,
      ['/disks'],
    ])
      assert.equal(safeStart(bad), '/', String(bad))
  })
})

describe('safeName: имя под иконкой', () => {
  it('обрезает до 20 символов и чистит пробелы', () => {
    assert.equal(safeName('Сеть и устройства', 'Mac Mini'), 'Сеть и устройства')
    assert.equal(safeName('  Диски  ', 'Mac Mini'), 'Диски')
    assert.equal(safeName('А'.repeat(30), 'Mac Mini'), 'А'.repeat(20))
    assert.equal(safeName('🎛🎛🎛'.padEnd(3, ''), 'Mac Mini'), '🎛🎛🎛') // по символам, эмодзи не рвутся
  })
  it('управляющие символы убирает, пустое и не-строку заменяет запасным именем', () => {
    assert.equal(safeName('Пуль\u0000т\u007f', 'Mac Mini'), 'Пульт')
    for (const bad of ['', '   ', '\n\t', undefined, null, { toString: () => 'x' }]) assert.equal(safeName(bad, 'Mac Mini'), 'Mac Mini', String(bad))
  })
  it('кавычки и слэши остаются именем, а не ломают JSON', () => {
    const m = manifestFor('/disks', 'Ди"ски\\')
    assert.equal(m.name, 'Ди"ски\\')
    assert.deepEqual(JSON.parse(JSON.stringify(m)).name, 'Ди"ски\\')
  })
})

describe('buildManifest: id и start_url', () => {
  it('id равен start_url, scope остаётся «/», поля основы копируются', () => {
    const m = buildManifest({ scope: '/x', display: 'standalone', theme_color: '#0f172a', icons: [1] }, '/disks', 'Диски')
    assert.equal(m.id, '/disks')
    assert.equal(m.start_url, '/disks')
    assert.equal(m.scope, '/')
    assert.equal(m.name, 'Диски')
    assert.equal(m.short_name, 'Диски')
    assert.equal(m.display, 'standalone')
    assert.equal(m.theme_color, '#0f172a')
    assert.deepEqual(m.icons, [1])
  })
})

describe(`GET ${MANIFEST_PATH}`, () => {
  it('отдаётся без входа (явное исключение в auth)', async () => {
    assert.ok(PUBLIC_PATHS.has(MANIFEST_PATH))
    const { res } = await get('?start=/disks&name=Диски')
    assert.equal(res.statusCode, 200)
    assert.match(res.headers['content-type'] as string, /application\/manifest\+json/)
    assert.equal(res.headers['cache-control'], 'no-cache')
  })
  it('start и name попадают в id, start_url, name и short_name', async () => {
    const { body } = await get('?start=' + encodeURIComponent('/media-control?tab=universal') + '&name=' + encodeURIComponent('Пульт'))
    assert.equal(body.id, '/media-control?tab=universal')
    assert.equal(body.start_url, '/media-control?tab=universal')
    assert.equal(body.name, 'Пульт')
    assert.equal(body.short_name, 'Пульт')
  })
  it('иконки, цвета и display берутся из статичного манифеста', async () => {
    const { body } = await get('?start=/disks&name=Диски')
    assert.equal(body.display, 'standalone')
    assert.equal(body.theme_color, '#0f172a')
    assert.equal(body.scope, '/')
    assert.deepEqual(body.icons, [{ src: '/images/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }])
  })
  it('без параметров — как статичный манифест: start_url «/» и имя панели', async () => {
    const { body } = await get()
    assert.equal(body.start_url, '/')
    assert.equal(body.id, '/')
    assert.equal(body.short_name, 'Mac Mini')
  })
  it('внешний адрес в start не уходит в манифест', async () => {
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com']) {
      const { body } = await get('?start=' + encodeURIComponent(bad) + '&name=X')
      assert.equal(body.start_url, '/', bad)
      assert.equal(body.id, '/', bad)
    }
  })
})
