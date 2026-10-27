// Тесты service worker (public/sw.js): навигационный запрос идёт в сеть по своему адресу, при обрыве связи
// отдаётся копия именно этой страницы, а если её нет — офлайн-заглушка, но никогда кешированная «/»
// (иначе иконка с экрана «Домой» открывала бы главную вместо своего start_url).
// sw.js — не модуль: это глобалы service worker (self, caches, fetch, location) и в сборку TypeScript он не входит.
// Поэтому файл выполняется здесь в поддельной области видимости — глобалы передаются аргументами.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const CODE = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')
const ORIGIN = 'http://192.168.31.112:7575'
const CACHE = 'panel-shell-v2' // имя кеша текущей версии: при правке VERSION в sw.js поднимается и здесь

type Res = { url: string; ok: boolean; from: string; clone(): Res }
type Req = { url: string; method: string; mode: string }

const res = (from: string, url: string, ok = true): Res => ({ url, ok, from, clone: () => res(from, url, ok) })
const req = (path: string, mode = 'navigate', method = 'GET'): Req => ({ url: new URL(path, ORIGIN).href, method, mode })
const keyOf = (r: Req | string) => {
  const { pathname, search } = new URL(typeof r === 'string' ? r : r.url, ORIGIN)
  return pathname + search
}

class FakeCache {
  store = new Map<string, Res>()
  async addAll(urls: string[]) {
    for (const u of urls) this.store.set(keyOf(u), res('shell', u))
  }
  async put(r: Req | string, v: Res) {
    this.store.set(keyOf(r), v)
  }
  async match(r: Req | string) {
    return this.store.get(keyOf(r))
  }
}

type Event = { request?: Req; waits: Promise<unknown>[]; waitUntil(p: Promise<unknown>): void; respondWith(p: Promise<Res | undefined>): void }
type Listener = (e: Event) => void

// Поддельная область видимости service worker + загрузка sw.js в неё
function mount(net: (r: Req) => Promise<Res>) {
  const opened = new Map<string, FakeCache>()
  const calls = { skipWaiting: 0, claim: 0, net: [] as string[] }
  const cacheApi = {
    async open(name: string) {
      const c = opened.get(name) ?? new FakeCache()
      opened.set(name, c)
      return c
    },
    async keys() {
      return [...opened.keys()]
    },
    async delete(name: string) {
      return opened.delete(name)
    },
    async match(r: Req | string) {
      for (const c of opened.values()) {
        const hit = await c.match(r)
        if (hit) return hit
      }
      return undefined
    },
  }
  const listeners: Record<string, Listener> = {}
  const scope = {
    addEventListener: (type: string, fn: Listener) => void (listeners[type] = fn),
    skipWaiting: () => void calls.skipWaiting++,
    clients: { claim: async () => void calls.claim++ },
  }
  const fetchApi = (r: Req) => {
    calls.net.push(keyOf(r))
    return net(r)
  }
  // sw.js работает с глобалами, поэтому выполняем его как функцию от этих глобалов (разбирать его на модули нельзя:
  // браузер грузит public/sw.js как есть)
  new Function('self', 'caches', 'fetch', 'location', CODE)(scope, cacheApi, fetchApi, { origin: ORIGIN })

  const fire = async (type: 'install' | 'activate') => {
    const e: Event = { waits: [], waitUntil(p) { this.waits.push(p) }, respondWith() {} }
    listeners[type](e)
    await Promise.all(e.waits)
  }
  const navigate = async (r: Req) => {
    let answer: Promise<Res | undefined> | undefined
    const e: Event = { request: r, waits: [], waitUntil(p) { this.waits.push(p) }, respondWith(p) { answer = p } }
    listeners.fetch(e)
    const out = answer ? await answer : undefined
    await Promise.all(e.waits)
    return { handled: answer !== undefined, res: out }
  }
  return { opened, calls, fire, navigate, cache: () => opened.get(CACHE)! }
}

const online = (r: Req) => Promise.resolve(res('network', r.url))
const offline = () => Promise.reject(new Error('нет сети'))

describe('sw.js: install и activate', () => {
  it('кладёт заглушку и иконку в кеш текущей версии и не ждёт закрытия вкладок', async () => {
    const sw = mount(online)
    await sw.fire('install')
    assert.deepEqual([...sw.cache().store.keys()], ['/offline.html', '/images/icon-192.png'])
    assert.equal(sw.calls.skipWaiting, 1)
  })
  it('удаляет кеши прошлых версий и забирает управление страницами', async () => {
    const sw = mount(online)
    await sw.fire('install')
    sw.opened.set('panel-shell-v1', new FakeCache())
    sw.opened.set('чужой-кеш', new FakeCache())
    await sw.fire('activate')
    assert.deepEqual([...sw.opened.keys()], [CACHE, 'чужой-кеш'])
    assert.equal(sw.calls.claim, 1)
  })
})

describe('sw.js: переходы по страницам', () => {
  it('в сети: ответ из сети по запрошенному адресу, он же попадает в кеш', async () => {
    const sw = mount(online)
    await sw.fire('install')
    const { handled, res: out } = await sw.navigate(req('/media-control?tab=universal'))
    assert.equal(handled, true)
    assert.equal(out?.from, 'network')
    assert.equal(out?.url, `${ORIGIN}/media-control?tab=universal`)
    assert.deepEqual(sw.calls.net, ['/media-control?tab=universal'])
    assert.ok(sw.cache().store.has('/media-control?tab=universal'))
  })
  it('нет сети: отдаёт копию именно этой страницы', async () => {
    const sw = mount(offline)
    await sw.fire('install')
    await sw.cache().put('/media-control?tab=universal', res('кеш страницы', '/media-control?tab=universal'))
    const { res: out } = await sw.navigate(req('/media-control?tab=universal'))
    assert.equal(out?.from, 'кеш страницы')
  })
  it('нет сети и этой страницы в кеше: заглушка, а не кешированная «/»', async () => {
    const sw = mount(offline)
    await sw.fire('install')
    await sw.cache().put('/', res('главная', '/'))
    const { res: out } = await sw.navigate(req('/media-control?tab=universal'))
    assert.equal(out?.from, 'shell')
    assert.equal(out?.url, '/offline.html')
  })
  it('неудачный ответ сети в кеш не кладётся', async () => {
    const sw = mount((r) => Promise.resolve(res('network', r.url, false)))
    await sw.fire('install')
    const { res: out } = await sw.navigate(req('/disks'))
    assert.equal(out?.from, 'network')
    assert.equal(sw.cache().store.has('/disks'), false)
  })
})

describe('sw.js: что остаётся вне кеша', () => {
  it('API, чужой адрес и не-GET идут мимо SW', async () => {
    const sw = mount(online)
    await sw.fire('install')
    for (const r of [req('/api/system/overview'), { url: 'https://example.com/x', method: 'GET', mode: 'navigate' }, req('/disks', 'navigate', 'POST')]) {
      const { handled } = await sw.navigate(r)
      assert.equal(handled, false, r.url)
    }
    assert.deepEqual(sw.calls.net, [])
  })
  it('хэшированная статика: кеш-first как раньше', async () => {
    const sw = mount(online)
    await sw.fire('install')
    const r = req('/assets/index-DmRMLUPf.js', 'no-cors')
    assert.equal((await sw.navigate(r)).res?.from, 'network')
    assert.equal(sw.calls.net.length, 1)
    assert.equal((await sw.navigate(r)).res?.from, 'network') // уже из кеша: второго запроса в сеть нет
    assert.equal(sw.calls.net.length, 1)
  })
})
