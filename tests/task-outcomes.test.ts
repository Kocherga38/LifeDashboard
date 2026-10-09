import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testDatabase } from './db.js'
import { migrate } from '../server/database.js'
import { createApi } from '../server/api.js'

test('Task outcomes survive migration, recurring moves, history, export and restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'trellis-task-outcomes-'))
  let db = await testDatabase(directory)
  const oldId = randomUUID()
  await db.query(`CREATE TABLE tasks(id UUID PRIMARY KEY,title VARCHAR(200) NOT NULL,task_date DATE NOT NULL,completed BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
  await db.query(`CREATE TABLE task_occurrences(task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,occurrence_date DATE NOT NULL,completed BOOLEAN NOT NULL DEFAULT FALSE,PRIMARY KEY(task_id,occurrence_date))`)
  await db.query(`INSERT INTO tasks(id,title,task_date,completed) VALUES($1,'Старая выполненная задача','2026-10-08',TRUE)`, [oldId])
  await db.query(`INSERT INTO task_occurrences(task_id,occurrence_date,completed) VALUES($1,'2026-10-08',TRUE)`, [oldId])
  await migrate(db)
  await migrate(db)
  assert.equal((await db.query(`SELECT completed,failed FROM tasks WHERE id=$1`, [oldId])).rows[0].completed, true)
  assert.equal((await db.query(`SELECT failed FROM tasks WHERE id=$1`, [oldId])).rows[0].failed, false)
  assert.equal((await db.query(`SELECT failed FROM task_occurrences WHERE task_id=$1`, [oldId])).rows[0].failed, false)
  const server = createApi(db).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const request = async (route: string, method = 'GET', body?: unknown) => {
    const response = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: response.status === 204 ? null : await response.json() }
  }
  const outcome = (body: any, completed: boolean, failed: boolean) => {
    assert.equal(body.completed, completed)
    assert.equal(body.failed, failed)
  }
  const list = async () => (await request('/api/tasks?from=2026-10-08&to=2026-10-14')).body as any[]
  let singleId = ''
  try {
    const single = await request('/api/tasks', 'POST', { title: 'Смена 9 октября', date: '2026-10-09', color: 'green' })
    assert.equal(single.status, 201)
    singleId = single.body.id
    outcome(single.body, false, false)
    const set = (body: unknown) => request(`/api/tasks/${singleId}`, 'PUT', body)
    outcome((await set({ failed: true })).body, false, true)
    outcome((await list()).find(t => t.id === singleId), false, true)
    const history = (await db.query(`SELECT * FROM activity_log WHERE table_name='tasks' AND record_key->>'id'=$1 ORDER BY id`, [singleId])).rows
    assert.equal(history.at(-1)!.before_data.failed, false)
    assert.equal(history.at(-1)!.after_data.failed, true)
    assert.equal(history.at(-1)!.after_data.completed, false)
    for (const invalid of [{ completed: true, failed: true }, { failed: 'true' }, { completed: 1 }, { failed: null }]) {
      assert.equal((await set(invalid)).status, 400)
      outcome((await list()).find(t => t.id === singleId), false, true)
    }
    // Existing clients still send only completed. Completion clears failure.
    outcome((await set({ completed: true })).body, true, false)
    outcome((await set({ completed: false })).body, false, false)
    outcome((await set({ failed: true })).body, false, true)
    outcome((await set({ failed: false })).body, false, false)
    outcome((await set({ failed: true })).body, false, true)
    outcome((await set({ title: 'Отменённая смена', date: '2026-10-09', color: 'green' })).body, false, true)
    const moved = await request(`/api/tasks/${singleId}/move`, 'POST', { fromDate: '2026-10-09', toDate: '2026-10-10' })
    outcome(moved.body, false, true)
    assert.equal(moved.body.date, '2026-10-10')
    await assert.rejects(db.query(`UPDATE tasks SET completed=TRUE,failed=TRUE WHERE id=$1`, [singleId]), /check constraint/)

    const recurring = (await request('/api/tasks', 'POST', { title: 'Повторяющаяся смена', date: '2026-10-08', recurrence: { type: 'interval', intervalDays: 1 } })).body
    const recurringSet = (body: unknown) => request(`/api/tasks/${recurring.id}`, 'PUT', body)
    outcome((await recurringSet({ failed: true, date: '2026-10-09' })).body, false, true)
    outcome((await recurringSet({ completed: true, date: '2026-10-11' })).body, true, false)
    let recurringRows = (await list()).filter(t => t.id === recurring.id)
    outcome(recurringRows.find(t => t.date === '2026-10-08'), false, false)
    outcome(recurringRows.find(t => t.date === '2026-10-09'), false, true)
    outcome(recurringRows.find(t => t.date === '2026-10-10'), false, false)
    const movedOccurrence = await request(`/api/tasks/${recurring.id}/move`, 'POST', { fromDate: '2026-10-09', toDate: '2026-10-12' })
    outcome(movedOccurrence.body, false, true)
    assert.equal(movedOccurrence.body.occurrenceDate, '2026-10-09')
    assert.equal((await recurringSet({ completed: true, failed: false, date: '2026-10-09', occurrenceDate: '2026-10-09' })).status, 400)
    outcome((await recurringSet({ failed: false, date: '2026-10-12', occurrenceDate: '2026-10-09' })).body, false, false)
    outcome((await recurringSet({ failed: true, date: '2026-10-12', occurrenceDate: '2026-10-09' })).body, false, true)
    // Editing the series does not clear the outcome of its individual days.
    await recurringSet({ title: 'Смены после изменения', date: '2026-10-08', recurrence: { type: 'interval', intervalDays: 1 } })
    recurringRows = (await list()).filter(t => t.id === recurring.id)
    assert.equal(recurringRows.some(t => t.date === '2026-10-09'), false)
    outcome(recurringRows.find(t => t.occurrenceDate === '2026-10-09'), false, true)
    outcome(recurringRows.find(t => t.occurrenceDate === '2026-10-12'), false, false)
    await assert.rejects(db.query(`UPDATE task_occurrences SET completed=TRUE,failed=TRUE WHERE task_id=$1 AND occurrence_date='2026-10-09'`, [recurring.id]), /check constraint/)
    const exported = (await request('/api/export')).body
    outcome(exported.tasks.find((t: any) => t.id === singleId), false, true)
    outcome(exported.task_occurrences.find((t: any) => t.task_id === recurring.id && String(t.occurrence_date).startsWith('2026-10-09')), false, true)
    assert.ok(exported.activity_log.some((entry: any) => entry.table_name === 'task_occurrences' && entry.after_data?.failed === true))
    assert.equal((await request(`/api/tasks/${recurring.id}`, 'DELETE')).status, 204)
    const preserved = (await list()).filter(t => t.title === 'Смены после изменения')
    assert.equal(preserved.length, 2)
    outcome(preserved.find(t => t.date === '2026-10-12'), false, true)
    outcome(preserved.find(t => t.date === '2026-10-11'), true, false)
    assert.equal((await set({ failed: true })).status, 200)
    assert.equal((await request(`/api/tasks/${randomUUID()}`, 'PUT', { failed: true })).status, 404)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await db.end()
  }
  try {
    db = await testDatabase(directory)
    await migrate(db)
    const saved = (await db.query(`SELECT completed,failed FROM tasks WHERE id=$1`, [singleId])).rows[0]
    outcome(saved, false, true)
    assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM tasks WHERE failed=TRUE`)).rows[0].n, 2)
  } finally {
    await db.end()
    await rm(directory, { recursive: true, force: true })
  }
})
