import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { testDatabase } from './db.js'
import { migrate } from '../server/database.js'
import { createPersonalApi } from '../server/personal-api.js'
import { createPlanningApi } from '../server/planning-api.js'
import { createApi } from '../server/api.js'
import { MAX_DIARY_AUDIO_BYTES } from '../shared/diary-audio.js'
import { MAX_DIARY_IMAGE_BYTES } from '../shared/diary.js'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const image = (dataUrl = png) => ({ id: randomUUID(), name: 'Фото.png', dataUrl })

test('Дневник сохраняет картинки, редактирует вложения и включает их в резервную копию', async () => {
  const db = await testDatabase()
  await migrate(db)
  const legacyId = randomUUID()
  await db.query(`INSERT INTO diary_entries(id,entry_date,content) VALUES($1,'2026-10-02','Старая запись')`, [legacyId])
  await migrate(db)
  const app = express()
  // Same middleware order as the application: verify the larger diary body limit survives it.
  app.use(createPersonalApi(db))
  app.use(createPlanningApi(db))
  app.use(createApi(db))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(url + path, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: response.status, body: response.status === 204 ? null : await response.json() }
  }
  try {
    const note = await request('/api/notes', 'POST', { title: 'Заметка', content: 'Текст' })
    assert.equal((await request(`/api/notes/${note.body.id}`, 'PUT', { title: 'Заметка', content: 'Новый текст' })).status, 200)
    assert.deepEqual((await request('/api/diary')).body[0].images, [])
    assert.deepEqual((await request('/api/diary')).body[0].audio, [])
    const voice = (dataUrl = 'data:audio/mp4;base64,AAAA') => ({ id: randomUUID(), name: 'Голосовое.m4a', dataUrl })
    const voices = [voice(), voice('data:audio/webm;base64,AAAA')]
    const voiceInput = { date: '2026-10-03', content: '', audio: voices }
    const voiceCreated = await request('/api/diary', 'POST', voiceInput)
    assert.equal(voiceCreated.status, 201)
    const voiceId = voiceCreated.body.id
    assert.deepEqual(voiceCreated.body.audio, voices)
    assert.deepEqual((await request('/api/diary')).body.find((x: { id: string }) => x.id === voiceId).audio, voices)
    assert.deepEqual((await request('/api/export')).body.diary_entries.find((x: { id: string }) => x.id === voiceId).audio, voices)
    assert.deepEqual((await request(`/api/diary/${voiceId}`, 'PUT', { ...voiceInput, audio: [voices[1]] })).body.audio, [voices[1]])
    assert.deepEqual((await request(`/api/diary/${voiceId}`, 'PUT', { date: voiceInput.date, content: 'Старый клиент' })).body.audio, [voices[1]])
    assert.equal((await request(`/api/diary/${voiceId}`, 'PUT', { ...voiceInput, audio: [] })).status, 400)
    assert.deepEqual((await request(`/api/diary/${voiceId}`, 'PUT', { ...voiceInput, content: 'Без аудио', audio: [] })).body.audio, [])
    for (const invalid of [null, {}, Array.from({ length: 4 }, () => voice()), [voices[0], voices[0]],
      [voice('data:text/html;base64,AAAA')], [voice('https://example.com/audio.mp3')],
      [voice('data:audio/mp4;base64,!!!!')], [voice('data:audio/mp4;base64,' + Buffer.alloc(MAX_DIARY_AUDIO_BYTES + 1).toString('base64'))]]) {
      assert.equal((await request('/api/diary', 'POST', { ...voiceInput, audio: invalid })).status, 400)
    }
    const largeVoice = voice('data:audio/mp4;base64,' + Buffer.alloc(MAX_DIARY_AUDIO_BYTES).toString('base64'))
    assert.equal((await request('/api/diary', 'POST', { ...voiceInput, audio: [largeVoice] })).status, 201)
    assert.equal((await request(`/api/diary/${voiceId}`, 'DELETE')).status, 204)
    const attachments = [image(), image()]
    const input = { date: '2026-10-03', title: 'Фото', content: '', images: attachments }
    const created = await request('/api/diary', 'POST', input)
    assert.equal(created.status, 201)
    assert.deepEqual(created.body.images, attachments)
    const id = created.body.id
    assert.deepEqual((await request('/api/diary')).body.find((x: { id: string }) => x.id === id).images, attachments)
    assert.deepEqual((await request('/api/export')).body.diary_entries.find((x: { id: string }) => x.id === id).images, attachments)
    assert.equal((await request('/api/diary', 'POST', { ...input, images: [] })).status, 400)
    for (const invalid of [null, {}, Array.from({ length: 9 }, () => image()), [attachments[0], attachments[0]],
      [image('data:image/svg+xml;base64,PHN2Zy8+')], [image('https://example.com/image.png')],
      [image('data:image/png;base64,!!!!')], [image('data:image/png;base64,' + Buffer.alloc(MAX_DIARY_IMAGE_BYTES + 1).toString('base64'))]]) {
      assert.equal((await request('/api/diary', 'POST', { ...input, images: invalid })).status, 400)
    }
    const edited = await request(`/api/diary/${id}`, 'PUT', { ...input, content: 'Обновлено', images: [attachments[1]] })
    assert.deepEqual(edited.body.images, [attachments[1]])
    const legacyEdit = await request(`/api/diary/${id}`, 'PUT', { date: input.date, content: 'Без поля images' })
    assert.deepEqual(legacyEdit.body.images, [attachments[1]])
    const removed = await request(`/api/diary/${id}`, 'PUT', { ...input, content: 'Только текст', images: [] })
    assert.deepEqual(removed.body.images, [])
    // A normal batch can exceed the old 2 MB request limit.
    const large = Array.from({ length: 3 }, () => image('data:image/png;base64,' + Buffer.alloc(700000).toString('base64')))
    assert.equal((await request('/api/diary', 'POST', { ...input, images: large })).status, 201)
    assert.equal((await request(`/api/diary/${id}`, 'DELETE')).status, 204)
    assert.equal((await request('/api/diary')).body.some((x: { id: string }) => x.id === id), false)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await db.end()
  }
})
