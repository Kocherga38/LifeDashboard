import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { testDatabase } from './db.js'
import { migrate } from '../server/database.js'
import { createPersonalApi } from '../server/personal-api.js'
import { monthlyGoalRows, monthlyGoalDescendants } from '../src/goalTypes.js'

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

    const october = { parentId: created.body.id, month: '2026-10', title: 'Начать тренировки', description: 'Оформить абонемент и войти в ритм', nextStep: 'Найти зал' }
    assert.equal((await request('/api/monthly-goals', 'POST', { ...october, month: '2026-13' })).status, 400)
    assert.equal((await request('/api/monthly-goals', 'POST', { ...october, parentId: '22222222-2222-4222-8222-222222222222' })).status, 404)
    const subgoal = await request('/api/monthly-goals', 'POST', october)
    assert.equal(subgoal.status, 201)
    assert.equal(subgoal.body.month, '2026-10')
    assert.equal(subgoal.body.parentId, created.body.id)
    assert.equal((await request('/api/monthly-goals?month=2026-10')).body.length, 1)
    assert.deepEqual((await request('/api/monthly-goals?month=2026-11')).body, [])
    assert.equal((await request('/api/monthly-goals?month=bad')).status, 400)
    const moved = await request(`/api/monthly-goals/${subgoal.body.id}`, 'PUT', { ...october, month: '2026-11', completed: true })
    assert.equal(moved.body.completed, true)
    assert.equal(moved.body.month, '2026-11')
    assert.deepEqual((await request('/api/monthly-goals?month=2026-10')).body, [])
    assert.equal((await request('/api/monthly-goals?month=2026-11')).body[0].title, october.title)

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
    assert.equal(exportResult.body.monthly_goals.length, 1)
    assert.equal((await request(`/api/personal-goals/${created.body.id}`, 'DELETE')).status, 204)
    assert.deepEqual((await request('/api/personal-goals')).body, [])
    assert.deepEqual((await request('/api/monthly-goals?month=2026-11')).body, [])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await db.end()
  }
})

test('Вложенные подцели сохраняют дерево, переносятся веткой и остаются в истории после удаления', async () => {
  const db = await testDatabase()
  await migrate(db)
  const app = express().use(createPersonalApi(db))
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
    const big = (await request('/api/personal-goals', 'POST', { title: '41 смена' })).body
    const other = (await request('/api/personal-goals', 'POST', { title: 'Другая цель' })).body
    const rootInput = { parentId: big.id, month: '2026-10', title: '10 смен в октябре' }
    const root = (await request('/api/monthly-goals', 'POST', rootInput)).body
    assert.equal(root.parentSubgoalId, null)
    const childInput = { ...rootInput, parentSubgoalId: root.id, title: '4 смены за неделю' }
    const childResult = await request('/api/monthly-goals', 'POST', childInput)
    assert.equal(childResult.status, 201)
    const child = childResult.body
    const grandchildResult = await request('/api/monthly-goals', 'POST', { ...childInput, parentSubgoalId: child.id, title: 'Первая смена' })
    assert.equal(grandchildResult.status, 201)
    const grandchild = grandchildResult.body
    const sibling = (await request('/api/monthly-goals', 'POST', { ...rootInput, title: 'Отдельный результат' })).body

    // Invalid parents, cross-month links and cycles must not modify existing rows.
    for (const invalid of [
      { ...childInput, parentSubgoalId: 'bad' },
      { ...childInput, parentSubgoalId: '22222222-2222-4222-8222-222222222222' },
      { ...childInput, month: '2026-11' },
      { ...childInput, parentId: other.id }
    ]) assert.equal((await request('/api/monthly-goals', 'POST', invalid)).status, 400)
    for (const parentSubgoalId of [root.id, child.id, grandchild.id]) {
      assert.equal((await request(`/api/monthly-goals/${root.id}`, 'PUT', { ...root, parentSubgoalId })).status, 400)
    }
    assert.equal((await request(`/api/monthly-goals/${grandchild.id}`, 'PUT', { ...grandchild, completed: true })).status, 200)
    const goals = (await request('/api/monthly-goals?month=2026-10')).body
    assert.deepEqual(monthlyGoalRows(goals).map(({ goal, depth }) => [goal.id, depth]), [
      [root.id, 0], [child.id, 1], [grandchild.id, 2], [sibling.id, 0]
    ])
    assert.deepEqual([...monthlyGoalDescendants(goals, root.id)].sort(), [child.id, grandchild.id].sort())
    assert.equal(goals.find((goal: { id: string }) => goal.id === root.id).completed, false)

    // Reparent a branch, then detach and move it to another month and big goal.
    assert.equal((await request(`/api/monthly-goals/${child.id}`, 'PUT', { ...child, parentSubgoalId: sibling.id })).status, 200)
    const detached = await request(`/api/monthly-goals/${child.id}`, 'PUT', {
      ...child, parentSubgoalId: null, parentId: other.id, month: '2026-11'
    })
    assert.equal(detached.status, 200)
    const november = (await request('/api/monthly-goals?month=2026-11')).body
    assert.equal(november.length, 2)
    assert.ok(november.every((goal: { parentId: string }) => goal.parentId === other.id))
    assert.equal(november.find((goal: { id: string }) => goal.id === grandchild.id).parentSubgoalId, child.id)
    assert.equal((await request('/api/monthly-goals?month=2026-10')).body.length, 2)
    await migrate(db)
    assert.equal((await request('/api/monthly-goals?month=2026-11')).body.length, 2)
    const backup = (await request('/api/export')).body
    assert.equal(backup.monthly_goals.find((goal: { id: string }) => goal.id === grandchild.id).parent_subgoal_id, child.id)

    assert.equal((await request(`/api/monthly-goals/${child.id}`, 'DELETE')).status, 204)
    assert.deepEqual((await request('/api/monthly-goals?month=2026-11')).body, [])
    const history = (await db.query(`SELECT * FROM activity_log WHERE table_name='monthly_goals' AND action='delete' AND record_key->>'id'=$1`, [grandchild.id])).rows
    assert.equal(history.length, 1)
    assert.equal(history[0].before_data.parent_subgoal_id, child.id)
    assert.equal(history[0].before_data.title, 'Первая смена')
    assert.equal((await request('/api/monthly-goals?month=2026-10')).body.length, 2)
    assert.equal((await request(`/api/personal-goals/${big.id}`, 'DELETE')).status, 204)
    assert.deepEqual((await request('/api/monthly-goals?month=2026-10')).body, [])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await db.end()
  }
})

test('Миграция сохраняет существующие месячные подцели без вложенности', async () => {
  const db = await testDatabase()
  try {
    await db.query(`CREATE TABLE personal_goals(
      id UUID PRIMARY KEY,title VARCHAR(160) NOT NULL,description TEXT NOT NULL DEFAULT '',
      next_step VARCHAR(300) NOT NULL DEFAULT '',due_date DATE,status TEXT NOT NULL DEFAULT 'active',
      pinned BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
    await db.query(`CREATE TABLE monthly_goals(
      id UUID PRIMARY KEY,parent_id UUID NOT NULL REFERENCES personal_goals(id) ON DELETE CASCADE,
      month DATE NOT NULL,title VARCHAR(160) NOT NULL,description TEXT NOT NULL DEFAULT '',
      next_step VARCHAR(300) NOT NULL DEFAULT '',completed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
    const big = '11111111-1111-4111-8111-111111111111'
    const monthly = '22222222-2222-4222-8222-222222222222'
    await db.query(`INSERT INTO personal_goals(id,title) VALUES($1,'41 смена')`, [big])
    await db.query(`INSERT INTO monthly_goals(id,parent_id,month,title) VALUES($1,$2,'2026-10-01','10 смен')`, [monthly, big])
    await migrate(db)
    await migrate(db)
    const saved = (await db.query(`SELECT * FROM monthly_goals WHERE id=$1`, [monthly])).rows[0]
    assert.equal(saved.title, '10 смен')
    assert.equal(saved.parent_id, big)
    assert.equal(saved.parent_subgoal_id, null)
  } finally { await db.end() }
})
