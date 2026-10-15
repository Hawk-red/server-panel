// Чат с Ollama: ответ дописывается и сохраняется, даже если клиент ушёл; отмена — только явным stop()
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { PassThrough } from 'node:stream'
import type { ServerResponse } from 'node:http'

process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'aichat-'))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let fake: http.Server
let slow = false // slow: бесконечный поток, пока не оборвут
let aborted = false
let aiChat: typeof import('./aiChat.js')

before(async () => {
  fake = http.createServer((req, res) => {
    req.resume()
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    res.on('close', () => { if (!res.writableFinished) aborted = true })
    const words = ['Привет', ', ', 'мир', '!']
    let i = 0
    const tick = setInterval(() => {
      if (slow) return void res.write(JSON.stringify({ message: { content: 'x' }, done: false }) + '\n')
      if (i < words.length) res.write(JSON.stringify({ message: { content: words[i++] }, done: false }) + '\n')
      else {
        res.end(JSON.stringify({ message: { content: '' }, done: true, eval_count: 4, eval_duration: 2e9, total_duration: 3e9 }) + '\n')
        clearInterval(tick)
      }
    }, 150)
    res.on('close', () => clearInterval(tick))
  })
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r))
  process.env.OLLAMA_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`
  aiChat = await import('./aiChat.js')
})
after(() => fake.close())

const fakeRes = () => {
  const pt = new PassThrough()
  return pt as unknown as ServerResponse
}

describe('AI-чат: фоновая генерация', () => {
  it('клиент отключился посреди ответа — ответ всё равно дописан и сохранён', async () => {
    assert.equal(aiChat.start('привет', null).ok, true)
    const res = fakeRes()
    assert.ok(aiChat.subscribe(res))
    await sleep(200)
    res.destroy() // «вкладку усыпили»
    assert.equal(aiChat.getState().generating, true)
    assert.equal(aborted, false)
    for (let i = 0; i < 40 && aiChat.isGenerating(); i++) await sleep(100)
    const st = aiChat.getState()
    assert.equal(st.generating, false)
    assert.equal(st.messages.length, 2)
    assert.equal(st.messages[1].content, 'Привет, мир!')
    assert.equal(st.messages[1].status, 'done')
    assert.equal(st.messages[1].stats?.tokens, 4)
    assert.equal(aborted, false)
  })
  it('второй вопрос во время генерации отклоняется, история попадает в базу', async () => {
    assert.equal(aiChat.start('второй', null).ok, true)
    assert.equal(aiChat.start('третий', null).ok, false)
    for (let i = 0; i < 40 && aiChat.isGenerating(); i++) await sleep(100)
    assert.equal(aiChat.getState().messages.length, 4)
  })
  it('частичный текст виден в состоянии, пока генерация идёт', async () => {
    aiChat.start('третий', null)
    await sleep(500)
    const st = aiChat.getState()
    assert.equal(st.generating, true)
    const last = st.messages[st.messages.length - 1]
    assert.equal(last.status, 'generating')
    assert.ok(last.content.startsWith('Привет'))
    for (let i = 0; i < 40 && aiChat.isGenerating(); i++) await sleep(100)
  })
  it('«Стоп» отменяет генерацию и сохраняет полученный текст', async () => {
    slow = true
    aiChat.start('долго', null)
    await sleep(500)
    assert.equal(aiChat.stop(), true)
    for (let i = 0; i < 40 && aiChat.isGenerating(); i++) await sleep(100)
    const last = aiChat.getState().messages.at(-1)!
    assert.equal(last.status, 'stopped')
    assert.ok(last.content.length > 0)
    await sleep(200)
    assert.equal(aborted, true)
    slow = false
  })
  it('очистка удаляет диалог', () => {
    assert.equal(aiChat.clearChat(), true)
    assert.equal(aiChat.getState().messages.length, 0)
  })
})
