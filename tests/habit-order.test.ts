import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { testDatabase } from './db.js'
import { migrate } from '../server/database.js'
import { createPersonalApi } from '../server/personal-api.js'

test('порядок трекеров сохраняется без потери отметок и с новыми трекерами в конце', async () => {
  const db = await testDatabase()
  await migrate(db)
  const app = express()
  app.use(createPersonalApi(db))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port

  async function request(path: string, method = 'GET', data?: unknown) {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data)
    })
    return { status: response.status, body: response.status === 204 ? null : await response.json() }
  }

  try {
    const a = (await request('/api/habits', 'POST', { name: 'Душ' })).body.id
    const b = (await request('/api/habits', 'POST', { name: 'Сон' })).body.id
    const c = (await request('/api/habits', 'POST', { name: 'Чтение' })).body.id
    assert.deepEqual((await request('/api/habits')).body.map((h: { id: string }) => h.id), [a, b, c])
    assert.equal((await request('/api/habits/' + a + '/toggle', 'POST', { date: '2026-10-22' })).status, 200)
    assert.equal((await request('/api/habits/order', 'PUT', { order: [c, a] })).status, 400)
    assert.equal((await request('/api/habits/order', 'PUT', { order: [c, c, a] })).status, 400)
    assert.equal((await request('/api/habits/order', 'PUT', { order: [c, b, a] })).status, 200)
    assert.deepEqual((await request('/api/habits')).body.map((h: { id: string }) => h.id), [c, b, a])
    const d = (await request('/api/habits', 'POST', { name: 'Спорт' })).body.id
    assert.deepEqual((await request('/api/habits')).body.map((h: { id: string }) => h.id), [c, b, a, d])
    assert.equal((await request('/api/habits/' + b, 'PUT', { name: 'Выспался' })).status, 200)
    assert.deepEqual((await request('/api/habits')).body.map((h: { id: string }) => h.id), [c, b, a, d])
    assert.deepEqual((await request('/api/habit-marks?from=2026-10-22&to=2026-10-22')).body, [{ habitId: a, date: '2026-10-22' }])
    const backup = await request('/api/export')
    assert.equal(backup.status, 200)
    assert.deepEqual(backup.body.app_settings.find((s: { key: string }) => s.key === 'habit-order').value, [c, b, a])
    assert.equal((await request('/api/habits/' + b, 'DELETE')).status, 204)
    assert.deepEqual((await request('/api/habits')).body.map((h: { id: string }) => h.id), [c, a, d])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await db.end()
  }
})
