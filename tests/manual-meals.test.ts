import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testDatabase } from './db.js'
import { migrate } from '../server/database.js'
import { createApi } from '../server/api.js'
import { mealNutrientTotal, validateEntry } from '../shared/journals.js'

const input = {
  mode: 'manual',
  date: '2026-10-21',
  meal: 'Завтрак',
  name: 'Блинчики на молоке',
  note: 'Весь рецепт, включая масло',
  kcal: 1535,
  protein: 45.2,
  fat: 71.6,
  carbs: 176.6
}

test('Ручной ввод КБЖУ проверяется и правильно складывается с продуктовыми порциями', () => {
  const entry = validateEntry('meals', input)
  assert.equal(entry.mode, 'manual')
  assert.equal(entry.grams, null)
  assert.equal(entry.fiber, null)
  assert.equal(mealNutrientTotal(entry, 'kcal'), 1535)
  assert.equal(mealNutrientTotal(entry, 'protein'), 45.2)
  const product = validateEntry('meals', {
    date: input.date, meal: input.meal, name: 'Молоко', grams: 200,
    time: '', note: '', kcal: 52, protein: 2.8, fat: 2.5, carbs: 4.7, fiber: 0
  })
  assert.equal(mealNutrientTotal(product, 'kcal'), 104)
  assert.equal(mealNutrientTotal(entry, 'kcal') + mealNutrientTotal(product, 'kcal'), 1639)
  for (const bad of [
    { ...input, name: '' },
    { ...input, kcal: -1 },
    { ...input, carbs: '176.6' },
    { ...input, fat: Number.POSITIVE_INFINITY },
    { ...input, protein: undefined },
    { ...input, mode: 'other' }
  ]) assert.throws(() => validateEntry('meals', bad))
})

test('Ручной приём пищи сохраняется, редактируется, экспортируется и переживает перезапуск', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'trellis-manual-meals-'))
  let db = await testDatabase(directory)
  await migrate(db)
  const server = createApi(db).listen(0, '127.0.0.1')
  await new Promise<void>((done) => server.once('listening', done))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const request = async (route: string, method = 'GET', body?: unknown) => {
    const r = await fetch(url + route, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: r.status, body: r.status === 204 ? null : await r.json() }
  }
  let id = ''
  try {
    const created = await request('/api/journal/meals', 'POST', input)
    assert.equal(created.status, 201)
    id = created.body.id
    assert.equal(created.body.kcal, 1535)
    assert.equal(created.body.note, input.note)
    assert.equal(created.body.grams, null)
    assert.equal((await request('/api/journal/meals')).body[0].mode, 'manual')
    const edited = await request(`/api/journal/meals/${id}`, 'PUT', { ...input, kcal: 1500, note: '' })
    assert.equal(edited.status, 200)
    assert.equal(edited.body.kcal, 1500)
    const exported = await request('/api/export')
    const record = exported.body.journal_entries.find((row: any) => row.id === id)
    assert.equal(record.data.kcal, 1500)
    assert.equal(record.data.name, input.name)
    assert.equal(record.data.mode, 'manual')
    assert.equal((await request('/api/journal/meals', 'POST', { ...input, protein: -10 })).status, 400)
    assert.equal((await request('/api/journal/meals', 'POST', { ...input, carbs: null })).status, 400)
  } finally {
    await new Promise<void>((done) => server.close(() => done()))
    await db.end()
  }
  try {
    db = await testDatabase(directory)
    await migrate(db)
    const row = (await db.query('SELECT data FROM journal_entries WHERE id=$1', [id])).rows[0]
    assert.equal(row.data.kcal, 1500)
    assert.equal(row.data.mode, 'manual')
    assert.equal(row.data.fiber, null)
  } finally {
    await db.end()
    await rm(directory, { recursive: true, force: true })
  }
})
