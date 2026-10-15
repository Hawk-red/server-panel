import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMatcher, matches, normalize, phoneticKey, searchScore, swapLayout, within1 } from './search.ts'

const MARANTZ = 'Marantz.Test.CD.Collection.VA.2000-2010.Flac.Tracks.Lossless'
const HUMMING = 'The.Hummingbird.Project.2018.1080p.BluRay.x264'

describe('поиск панели', () => {
  it('«марантз» находит Marantz.Test.CD…', () => assert.ok(matches('марантз', MARANTZ)))
  it('«marantz» находит «Марантз»', () => assert.ok(matches('marantz', 'Марантз')))
  it('«vfhfynp» (неверная раскладка) находит Marantz', () => {
    assert.equal(swapLayout('vfhfynp'), 'марантз')
    assert.ok(matches('vfhfynp', MARANTZ))
    assert.ok(matches('vfhfynp', 'Маранц усилитель'))
  })
  it('раскладка наоборот: «ьфкфтея» находит Marantz', () => assert.ok(matches('ьфкфтея', MARANTZ)))
  it('hummingbird / хаммингберд / хамингбёрд (опечатка)', () => {
    for (const q of ['hummingbird', 'хаммингберд', 'хамингбёрд']) assert.ok(matches(q, HUMMING), q)
  })
  it('«Hummingbird Project 2018» находит The.Hummingbird.Project.2018…', () => assert.ok(matches('Hummingbird Project 2018', HUMMING)))
  it('слова в любом порядке и в разных полях', () => {
    assert.ok(matches('2018 project hummingbird', HUMMING))
    assert.ok(matches('jellyfin сервис', 'jellyfin.service', 'медиасервер'))
    assert.equal(matches('hummingbird 1999', HUMMING), false)
  })
  it('jellyfin / джеллифин', () => {
    for (const q of ['jellyfin', 'джеллифин', 'джелифин']) assert.ok(matches(q, 'jellyfin'), q)
    assert.ok(matches('jellyfin', 'Джеллифин медиасервер'))
  })
  it('регистр и ё/е', () => {
    assert.ok(matches('МАРАНТЗ', 'marantz'))
    assert.ok(matches('ЁЖ', 'еж'))
    assert.ok(matches('елка', 'Ёлка'))
    assert.equal(normalize('Ёлка_Ёж'), 'елка еж')
  })
  it('разделители: точки, подчёркивания, дефисы, скобки', () => {
    assert.ok(matches('test cd collection', MARANTZ))
    assert.ok(matches('va 2000 2010', MARANTZ))
    assert.ok(matches('flac_tracks', 'Flac.Tracks'))
    assert.ok(matches('lossless', '(Lossless)[FLAC]'))
  })
  it('подстрока и опечатка (Левенштейн 1, слова от 5 символов)', () => {
    assert.ok(matches('collect', MARANTZ))
    assert.ok(matches('hummngbird', HUMMING))
    assert.ok(matches('lossles', MARANTZ))
    assert.equal(matches('ab', MARANTZ), false)
    assert.equal(matches('hxmmxngbxrd', HUMMING), false)
  })
  it('ничего лишнего: чужое не находится', () => {
    assert.equal(matches('qbittorrent', MARANTZ), false)
    assert.equal(matches('марантз', HUMMING), false)
  })
  it('ранжирование: точное > начало слова > подстрока > фонетика > опечатка', () => {
    const s = (q: string, t: string) => searchScore(q, t)
    assert.ok(s('flac', 'flac') > s('flac', 'flacs'))
    assert.ok(s('flac', 'flacs') > s('flac', 'reflac'))
    assert.ok(s('marantz', 'reflac marantz') > s('marantz', 'марантс'))
    assert.ok(s('hummingbird', 'hummingbirds') > s('hummingbird', 'hummngbird'))
  })
  it('пустой запрос подходит всему; пустой текст — ничему', () => {
    assert.equal(createMatcher('  ')('что угодно'), 1)
    assert.equal(createMatcher('abc')(null, undefined, ''), 0)
  })
  it('вспомогательные: within1, phoneticKey', () => {
    assert.ok(within1('abcde', 'abxde') && within1('abcde', 'abde') && within1('abde', 'abcde'))
    assert.equal(within1('abcde', 'axxde'), false)
    assert.equal(phoneticKey('марантз'), phoneticKey('marantz'))
    assert.equal(phoneticKey('хаммингберд'), phoneticKey('hummingbird'))
  })
})

describe('ранг: фонетическое совпадение выше опечаточного', () => {
  it('«хаммингберд» → hummingbird по ключу, а не по Левенштейну', () => {
    assert.ok(searchScore('хаммингберд', 'hummingbird') >= 0.6)
  })
})
