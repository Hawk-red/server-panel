import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { highlightParts, normalize, RECEIVER_GROUPS, RECEIVER_LINKS, RECEIVER_ROOT_PATH, searchLinks } from './receiver-links.ts'

describe('RECEIVER_LINKS', () => {
  it('только фреймсеты f_*.asp внутри /SETUP/<РАЗДЕЛ>/<СТРАНИЦА>/', () => {
    for (const l of RECEIVER_LINKS) assert.match(l.path, /^\/SETUP\/[A-Z0-9]+\/[A-Z0-9]+\/f_[A-Za-z_]+\.asp$/, l.path)
    assert.equal(RECEIVER_ROOT_PATH, '/')
  })
  it('нет запрещённых страниц (Firmware, Setup Lock, Default, Reset, Restore)', () => {
    for (const l of RECEIVER_LINKS) {
      // M-DAX в самом ресивере лежит по адресу RESTORER — это единственное допустимое «restore»
      const path = l.path.replace('/RESTORER/', '/MDAX/')
      for (const text of [path, l.ru, l.en, l.key]) assert.doesNotMatch(text, /firmware|setup\s*lock|setuplock|default|reset|restore|\bdef\b/i, `${l.key}: ${text}`)
    }
  })
  it('нет дублей путей и ключей', () => {
    assert.equal(new Set(RECEIVER_LINKS.map((l) => l.path)).size, RECEIVER_LINKS.length)
    assert.equal(new Set(RECEIVER_LINKS.map((l) => `${l.group}:${l.key}`)).size, RECEIVER_LINKS.length)
  })
  it('у каждой ссылки есть ru, en и подсказка; группа существует; раздел в пути соответствует группе', () => {
    const ids = new Set(RECEIVER_GROUPS.map((g) => g.id))
    for (const l of RECEIVER_LINKS) {
      assert.ok(l.ru && l.en && l.hint.length > 10, l.key)
      assert.ok(ids.has(l.group))
      assert.equal(l.path.split('/')[2], l.group.toUpperCase(), l.key)
    }
  })
  it('шесть групп, в каждой есть ссылки', () => {
    assert.equal(RECEIVER_GROUPS.length, 6)
    for (const g of RECEIVER_GROUPS) assert.ok(RECEIVER_LINKS.some((l) => l.group === g.id), g.id)
  })
  it('нужные страницы на месте, лишних нет', () => {
    const paths = new Set(RECEIVER_LINKS.map((l) => l.path))
    assert.ok(paths.has('/SETUP/AUDIO/RESTORER/f_audio.asp'))
    assert.ok(paths.has('/SETUP/GENERAL/AUTOSTANDBY/f_general.asp'))
    assert.ok(paths.has('/SETUP/GENERAL/INFORMATION/f_information.asp'))
    assert.ok(![...paths].some((p) => /FIRMWARE|SETUPLOCK|SETTINGS/.test(p)))
  })
  it('подсказка у Volume упоминает собственный Limit ресивера и потолок панели', () => {
    const v = RECEIVER_LINKS.find((l) => l.key === 'volume')!
    assert.match(v.hint, /Limit/)
    assert.match(v.hint, /потолк/)
  })
})

describe('поиск', () => {
  const keys = (q: string) => searchLinks(RECEIVER_LINKS, q).map((l) => l.key)
  it('пустой запрос — все ссылки', () => assert.equal(keys('').length, RECEIVER_LINKS.length))
  it('«дистанц» и «distances» находят Distances', () => {
    assert.deepEqual(keys('дистанц'), ['distances'])
    assert.ok(keys('distances').includes('distances'))
  })
  it('«громк» и «volume» находят Volume', () => {
    assert.ok(keys('громк').includes('volume'))
    assert.ok(keys('volume').includes('volume'))
  })
  it('без учёта регистра и ё/е', () => {
    assert.ok(keys('ДИСТАНЦ').includes('distances'))
    assert.ok(keys('VOLUME').includes('volume'))
    assert.equal(normalize('Ёлка'), 'елка')
  })
  it('нет совпадений — пустой список', () => assert.deepEqual(keys('qwertyuiop'), []))
  it('подсветка: части складываются в исходный текст', () => {
    const parts = highlightParts('Дистанции до колонок', 'дистанц')
    assert.equal(parts.map((p) => p.text).join(''), 'Дистанции до колонок')
    assert.deepEqual(parts[0], { text: 'Дистанц', match: true })
    assert.deepEqual(highlightParts('Abc', 'x'), [{ text: 'Abc', match: false }])
  })
})
