import test from 'node:test'
import assert from 'node:assert/strict'
import { testDatabase } from './db.js'
import { migrate } from '../server/database.js'
import { createApi } from '../server/api.js'

test('Своя категория доступна до первой операции, сохраняется и входит в выгрузку', async () => {
  const db = await testDatabase()
  await migrate(db)
  const server = createApi(db).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(url + path, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: response.status, body: await response.json() }
  }

  try {
    const created = await request('/api/operation-categories', 'POST', { name: 'Для дома', type: 'expense' })
    assert.equal(created.status, 409) // Встроенная категория уже доступна сразу.
    const custom = await request('/api/operation-categories', 'POST', { name: '  Мастерская  ', type: 'expense' })
    assert.equal(custom.status, 201)
    assert.equal(custom.body.name, 'Мастерская')
    assert.deepEqual((await request('/api/operation-categories')).body.map((item: { name: string }) => item.name), ['Мастерская'])
    assert.equal((await request('/api/operation-categories', 'POST', { name: 'мастерская', type: 'expense' })).status, 409)
    assert.equal((await request('/api/operation-categories', 'POST', { name: 'Пустая', type: 'other' })).status, 400)

    const operation = await request('/api/expenses', 'POST', {
      title: 'Инструменты', amount: 120, category: custom.body.name, type: 'expense', date: '2026-10-05'
    })
    assert.equal(operation.status, 201)
    assert.equal(operation.body.category, 'Мастерская')
    const backup = await request('/api/export')
    assert.equal(backup.body.operation_categories[0].name, 'Мастерская')
    assert.equal(backup.body.expenses[0].category, 'Мастерская')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await db.end()
  }
})
