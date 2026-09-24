import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { testDatabase } from './db.js'
import { migrate } from '../server/database.js'
import { createPersonalApi } from '../server/personal-api.js'
import { createApi } from '../server/api.js'

test('сон через полночь сохраняется, редактируется и входит в выгрузку', async () => {
  const db = await testDatabase()
  await migrate(db)
  await migrate(db)
  const app = express()
  app.use(createPersonalApi(db))
  app.use(createApi(db))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  async function request(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(url + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: response.status, body: response.status === 204 ? null : await response.json() }
  }
  try {
    const record = { sleptAt: '2026-09-23T23:40', wokeAt: '2026-09-24T08:10', note: 'Выспался' }
    let result = await request('/api/sleep', 'POST', record)
    assert.equal(result.status, 201)
    assert.equal(result.body.durationMinutes, 510)
    const id = result.body.id
    result = await request('/api/sleep', 'POST', { ...record, wokeAt: '2026-09-23T20:00' })
    assert.equal(result.status, 400)
    result = await request('/api/sleep', 'POST', { ...record, sleptAt: '2026-09-31T23:40' })
    assert.equal(result.status, 400)
    result = await request(`/api/sleep/${id}`, 'PUT', { ...record, wokeAt: '2026-09-24T09:10', note: 'После смены' })
    assert.equal(result.body.durationMinutes, 570)
    assert.equal((await request('/api/sleep')).body[0].note, 'После смены')
    const backup = await request('/api/export')
    assert.equal(backup.status, 200)
    assert.equal(backup.body.sleep_entries.length, 1)
    assert.equal(backup.body.sleep_entries[0].id, id)
    assert.equal((await request(`/api/sleep/${id}`, 'DELETE')).status, 204)
    assert.deepEqual((await request('/api/sleep')).body, [])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await db.end()
  }
})
