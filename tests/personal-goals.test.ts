import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { testDatabase } from './db.js'
import { migrate } from '../server/database.js'
import { createPersonalApi } from '../server/personal-api.js'

test('Цели сохраняются, меняют статус и входят в резервную выгрузку', async () => {
  const db = await testDatabase()
  await migrate(db)
  await migrate(db)
  const app = express()
  app.use(createPersonalApi(db))
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: error.message })
  })
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
    const input = { title: 'Набрать 70 кг', description: 'К июню 2027', nextStep: 'Записать вес', dueDate: '2027-06-01', pinned: true }
    const created = await request('/api/personal-goals', 'POST', input)
    assert.equal(created.status, 201)
    assert.equal(created.body.title, input.title)
    assert.equal(created.body.dueDate, input.dueDate)
    assert.equal(created.body.status, 'active')
    assert.equal((await request('/api/personal-goals')).body.length, 1)
    assert.equal((await request('/api/personal-goals', 'POST', { ...input, dueDate: '2027-02-30' })).status, 400)

    const changed = await request(`/api/personal-goals/${created.body.id}`, 'PUT', {
      ...input, title: 'Вес 70 кг', status: 'paused', pinned: false
    })
    assert.equal(changed.body.title, 'Вес 70 кг')
    assert.equal(changed.body.status, 'paused')
    assert.equal(changed.body.pinned, false)
    assert.equal((await request('/api/personal-goals')).body[0].status, 'paused')

    const exportResult = await request('/api/export')
    assert.equal(exportResult.body.personal_goals.length, 1)
    assert.equal(exportResult.body.personal_goals[0].title, 'Вес 70 кг')
    assert.equal((await request(`/api/personal-goals/${created.body.id}`, 'DELETE')).status, 204)
    assert.deepEqual((await request('/api/personal-goals')).body, [])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await db.end()
  }
})
