import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testDatabase } from './db.js'
import { migrate } from '../server/database.js'
import { createApi } from '../server/api.js'

test('Миграции, API, импорт Excel и сохранение после перезапуска', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'life-db-'))
  let db = await testDatabase(directory)
  // Начинаем со схемы старой версии и проверяем сохранность старой записи.
  await db.query(
    `CREATE TABLE expenses(id UUID PRIMARY KEY,title VARCHAR(100) NOT NULL,amount NUMERIC(12,2) NOT NULL CHECK(amount>0),category VARCHAR(100) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  )
  const oldId = '11111111-1111-4111-8111-111111111111'
  await db.query(
    `INSERT INTO expenses VALUES($1,'Старая запись',12.34,'Транспорт','2026-08-15T21:30:00Z')`,
    [oldId]
  )
  await migrate(db)
  await migrate(db)
  const server = createApi(db).listen(0, '127.0.0.1')
  await new Promise<void>((r) => server.once('listening', r))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  async function request(route: string, method = 'GET', body?: unknown) {
    const r = await fetch(url + route, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: r.status, body: r.status === 204 ? null : await r.json() }
  }
  try {
    let r = await request('/api/expenses')
    assert.equal(r.body[0].date, '2026-08-16')
    assert.equal(r.body[0].amount, 12.34)
    const input = {
      title: 'Проверка 0.10',
      amount: 0.1,
      category: 'Продукты',
      type: 'expense',
      date: '2026-09-15',
      note: 'Комментарий',
      subcategory: 'Магазин',
      counterparty: 'Тест'
    }
    r = await request('/api/expenses', 'POST', input)
    assert.equal(r.status, 201)
    const id = r.body.id
    r = await request(`/api/expenses/${id}`, 'PUT', { ...input, amount: 0.2 })
    assert.equal(r.body.amount, 0.2)
    assert.equal(r.body.note, 'Комментарий')
    assert.equal(
      (await request('/api/expenses', 'POST', { ...input, date: '2026-02-30' })).status,
      400
    )
    assert.equal((await request('/api/expenses', 'POST', { ...input, amount: -2 })).status, 400)
    await request(`/api/expenses/${id}`, 'DELETE')
    assert.equal((await request('/api/expenses')).body.length, 1)
    r = await request('/api/budgets', 'PUT', {
      month: '2026-09',
      category: 'Продукты',
      amount: 1000
    })
    const budgetId = r.body.id
    r = await request('/api/budgets', 'PUT', {
      month: '2026-09',
      category: 'Продукты',
      amount: 500
    })
    assert.equal(r.body.id, budgetId)
    assert.equal((await request('/api/budgets?month=2026-10')).body.length, 0)
    assert.equal((await request('/api/budgets?month=2026-13')).status, 400)
    const weight = await request('/api/journal/weights', 'POST', {
      date: '2026-09-16',
      weight: 62,
      note: ''
    })
    assert.equal(weight.status, 201)
    assert.equal(
      (await request('/api/journal/weights', 'POST', { date: '2026-09-16', weight: -2 })).status,
      400
    )
    assert.equal(
      (
        await request('/api/journal/workouts', 'POST', {
          date: '2026-09-16',
          name: 'Отжимания',
          sets: [8, 7.2],
          rest: 90,
          note: ''
        })
      ).status,
      400
    )
    assert.equal(
      (
        await request(`/api/journal/weights/${weight.body.id}`, 'PUT', {
          date: '2026-09-16',
          weight: 63,
          note: 'исправил'
        })
      ).body.weight,
      63
    )
    await request(`/api/journal/weights/${weight.body.id}`, 'DELETE')
    const task = await request('/api/tasks', 'POST', { title: 'Сходить в зал', date: '2026-09-18' })
    assert.equal(task.status, 201)
    assert.equal(task.body.completed, false)
    assert.equal((await request('/api/tasks?from=2026-09-14&to=2026-09-20')).body.length, 1)
    assert.equal(
      (await request(`/api/tasks/${task.body.id}`, 'PUT', { completed: true })).body.completed,
      true
    )
    const editedTask = await request(`/api/tasks/${task.body.id}`, 'PUT', {
      title: 'Сходить в зал вечером',
      date: '2026-09-18',
      recurrence: { type: 'none' }
    })
    assert.equal(editedTask.body.title, 'Сходить в зал вечером')
    const recurring = await request('/api/tasks', 'POST', {
      title: 'Тренировка',
      date: '2026-09-14',
      recurrence: { type: 'weekdays', weekdays: [0, 2, 4] }
    })
    assert.equal(recurring.status, 201)
    const recurringWeek = (await request('/api/tasks?from=2026-09-14&to=2026-09-20')).body.filter(
      (t: any) => t.id === recurring.body.id
    )
    assert.deepEqual(recurringWeek.map((t: any) => t.date), ['2026-09-14', '2026-09-16', '2026-09-18'])
    assert.equal(
      (
        await request(`/api/tasks/${recurring.body.id}`, 'PUT', {
          completed: true,
          date: '2026-09-16'
        })
      ).body.completed,
      true
    )
    const recurringAfter = (await request('/api/tasks?from=2026-09-14&to=2026-09-20')).body.filter(
      (t: any) => t.id === recurring.body.id
    )
    assert.equal(recurringAfter.find((t: any) => t.date === '2026-09-16').completed, true)
    await request(`/api/tasks/${recurring.body.id}`, 'DELETE')
    assert.equal(
      (await request('/api/tasks?from=2026-09-14&to=2026-09-20')).body.filter((t: any) => t.id === recurring.body.id).length,
      0
    )
    assert.equal((await request('/api/tasks?from=2026-09-14&to=bad')).status, 400)
    r = await request('/api/import/preview')
    assert.equal(r.body.counts.operations, 186)
    assert.equal(r.body.issues.length, 6)
    r = await request('/api/import/apply', 'POST')
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.operationsAdded, 186)
    assert.equal((await request('/api/import/apply', 'POST')).body.alreadyImported, true)
    assert.equal((await request('/api/expenses')).body.length, 187)
    assert.equal((await request('/api/journal/products')).body.length, 13)
    assert.equal((await request('/api/journal/shifts')).body.length, 10)
    assert.equal((await request('/api/journal/meals')).body.length, 15)
    const data = (await request('/api/expenses')).body.filter((o: any) => o.id !== oldId)
    const sum = (type: string, month: string) =>
      data
        .filter((o: any) => o.type === type && o.date.startsWith(month))
        .reduce((s: number, o: any) => s + Math.round(o.amount * 100), 0) / 100
    assert.equal(sum('expense', '2026-08'), 183185.52)
    assert.equal(sum('income', '2026-08'), 94944.21)
    const meals = (await request('/api/journal/meals')).body
    const eggs = meals.find((m: any) => m.name.startsWith('Яйцо'))
    assert.equal((eggs.kcal * eggs.grams) / 100, 282.6)
    assert.equal(
      (await request('/api/budget-template', 'POST', { month: '2026-09' })).body.added,
      10
    )
    assert.equal(
      (await request('/api/budgets?month=2026-09')).body.find((b: any) => b.id === budgetId).amount,
      500
    )
    assert.equal(
      (await request('/api/budget-template', 'POST', { month: '2026-09' })).body.added,
      0
    )
    const foreign = await fetch(url + '/api/expenses', {
      method: 'POST',
      headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    })
    assert.equal(foreign.status, 403)
    assert.equal((await request('/api/export')).body.expenses.length, 187)
    assert.equal((await request('/api/export')).body.tasks.length, 1)
    // Удалённая импортированная запись не появляется снова при повторном импорте.
    await request(`/api/expenses/${data[0].id}`, 'DELETE')
    await request('/api/import/apply', 'POST')
    assert.equal((await request('/api/expenses')).body.length, 186)
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
    await db.end()
  }
  db = await testDatabase(directory)
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM expenses')).rows[0].n, 186)
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM journal_entries')).rows[0].n, 43)
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM tasks')).rows[0].n, 1)
  await db.end()
  await rm(directory, { recursive: true, force: true })
})
