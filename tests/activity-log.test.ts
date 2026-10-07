import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testDatabase } from './db.js'
import { migrate } from '../server/database.js'
import { createApi } from '../server/api.js'
import { createPersonalApi } from '../server/personal-api.js'
import { createPlanningApi } from '../server/planning-api.js'
import { dataTables } from '../server/activity-log.js'

test('history keeps full task versions, cascades, snapshots and rolls back with changes; both backups are complete', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'trellis-history-'))
  let db = await testDatabase(directory)
  const oldId = randomUUID()
  await db.query(`CREATE TABLE tasks(id UUID PRIMARY KEY,title VARCHAR(200) NOT NULL,task_date DATE NOT NULL,completed BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
  await db.query(`INSERT INTO tasks(id,title,task_date) VALUES($1,'Уже планировал','2026-10-08')`, [oldId])
  await migrate(db)
  const snapshots = (await db.query(`SELECT * FROM activity_log WHERE action='snapshot'`)).rows
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0].after_data.title, 'Уже планировал')
  assert.equal(snapshots[0].before_data, null)
  await migrate(db)
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM activity_log`)).rows[0].n, 1)
  // Every business table, including both compound-key tables, has a history trigger.
  const tables = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'activity_log%'`)).rows.map((x) => x.tablename).sort()
  assert.deepEqual(tables, [...dataTables].sort())
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM pg_trigger WHERE tgname='trellis_activity'`)).rows[0].n, dataTables.length)
  const app = express().use(createPersonalApi(db)).use(createPlanningApi(db)).use(createApi(db))
  const server = app.listen(0, '127.0.0.1')
  const core = createApi(db).listen(0, '127.0.0.1')
  await Promise.all([server, core].map((s) => new Promise<void>((resolve) => s.once('listening', resolve))))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const coreUrl = `http://127.0.0.1:${(core.address() as { port: number }).port}`
  async function request(route: string, method = 'GET', body?: unknown) {
    const r = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, body: r.status === 204 ? null : await r.json() }
  }
  try {
    const created = await request('/api/tasks', 'POST', { title: 'Учить Go', date: '2026-10-08' })
    assert.equal(created.status, 201)
    const id = created.body.id
    assert.equal((await request(`/api/tasks/${id}`, 'PUT', { title: 'Учить Go 30 минут', date: '2026-10-09' })).status, 200)
    assert.equal((await request(`/api/tasks/${id}`, 'PUT', { completed: true })).status, 200)
    assert.equal((await request(`/api/tasks/${id}`, 'DELETE')).status, 204)
    const taskHistory = (await db.query(`SELECT * FROM activity_log WHERE table_name='tasks' AND record_key->>'id'=$1 ORDER BY id`, [id])).rows
    assert.deepEqual(taskHistory.map((x) => x.action), ['create','update','update','delete'])
    assert.equal(taskHistory[1].before_data.title, 'Учить Go')
    assert.equal(taskHistory[1].after_data.task_date, '2026-10-09')
    assert.equal(taskHistory[2].before_data.completed, false)
    assert.equal(taskHistory[2].after_data.completed, true)
    assert.equal(taskHistory[3].before_data.title, 'Учить Go 30 минут')
    assert.equal(taskHistory[3].after_data, null)
    const count = async () => (await db.query(`SELECT COUNT(*)::int AS n FROM activity_log`)).rows[0].n
    const beforeInvalid = await count()
    assert.equal((await request('/api/tasks', 'POST', { title: '', date: 'bad' })).status, 400)
    assert.equal((await request(`/api/tasks/${id}`, 'PUT', { completed: false })).status, 404)
    assert.equal(await count(), beforeInvalid)
    await db.query('BEGIN')
    await db.query(`UPDATE tasks SET title='Не должно сохраниться' WHERE id=$1`, [oldId])
    await db.query('ROLLBACK')
    assert.equal(await count(), beforeInvalid)
    await db.query(`UPDATE tasks SET title=title WHERE id=$1`, [oldId])
    assert.equal(await count(), beforeInvalid)
    await assert.rejects(db.query(`DELETE FROM activity_log`), /только для добавления/)
    await assert.rejects(db.query(`UPDATE activity_log SET action='delete'`), /только для добавления/)
    await assert.rejects(db.query(`TRUNCATE activity_log`), /только для добавления/)

    const folder = (await request('/api/note-folders', 'POST', { name: 'Проекты' })).body
    const note = (await request('/api/notes', 'POST', { folderId: folder.id, title: 'Смысл', content: 'Полный удалённый текст' })).body
    await request(`/api/note-folders/${folder.id}`, 'DELETE')
    const deletedNote = (await db.query(`SELECT * FROM activity_log WHERE table_name='notes' AND action='delete' AND record_key->>'id'=$1`, [note.id])).rows[0]
    assert.equal(deletedNote.before_data.content, 'Полный удалённый текст')
    const deletedFolder = (await db.query(`SELECT * FROM activity_log WHERE table_name='note_folders' AND action='delete' AND record_key->>'id'=$1`, [folder.id])).rows[0]
    assert.equal(String(deletedNote.transaction_id), String(deletedFolder.transaction_id))

    const image = { id: randomUUID(), name: 'Фото.png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }
    const diary = await request('/api/diary', 'POST', { date: '2026-10-08', title: 'Дневник с фото', content: 'Полный текст', images: [image] })
    assert.equal(diary.status, 201)
    await request(`/api/diary/${diary.body.id}`, 'DELETE')
    const diaryHistory = (await db.query(`SELECT * FROM activity_log WHERE table_name='diary_entries' AND action='delete' AND record_key->>'id'=$1`, [diary.body.id])).rows[0]
    assert.equal(diaryHistory.before_data.content, 'Полный текст')
    assert.deepEqual(diaryHistory.before_data.images, [image])

    const habit = (await request('/api/habits', 'POST', { name: 'Практика' })).body
    await request(`/api/habits/${habit.id}/toggle`, 'POST', { date: '2026-10-08' })
    await request(`/api/habits/${habit.id}`, 'DELETE')
    const mark = (await db.query(`SELECT * FROM activity_log WHERE table_name='habit_marks' AND action='delete'`)).rows[0]
    assert.deepEqual(mark.record_key, { habit_id: habit.id, mark_date: '2026-10-08' })
    assert.equal(mark.before_data.habit_id, habit.id)
    const template = (await request('/api/templates', 'POST', { title: 'Квартира', amount: 19000, category: 'Жильё', type: 'expense', templateKind: 'quick' })).body
    await request('/api/sidebar-order', 'PUT', { order: ['today','weekly','goals','operations','analytics','calendar','notes','diary','flashcards','habits','shifts','weights','sleep','measurements','meals','products','workouts','data'] })
    assert.ok((await db.query(`SELECT * FROM activity_log WHERE table_name='app_settings' AND record_key->>'key'='sidebar-order'`)).rows.length)
    assert.equal((await request('/api/activity', 'POST', { action: 'navigate', section: 'calendar' })).status, 204)
    assert.equal((await request('/api/activity', 'POST', { action: 'delete', section: 'calendar' })).status, 400)
    assert.equal((await request('/api/activity', 'POST', { action: 'export', format: 'txt', from: '2026-10-01', to: '2026-10-08' })).status, 204)
    assert.equal((await request('/api/activity', 'POST', { action: 'export', format: 'txt', from: 'bad', to: '' })).status, 400)
    assert.equal((await request('/api/activity?before=9223372036854775808')).status, 400)
    const listing = (await request('/api/activity')).body
    assert.ok(listing.entries.some((x: any) => x.action === 'navigate'))
    assert.equal('after_data' in listing.entries[0], false)
    const details = (await request(`/api/activity/${taskHistory[3].id}`)).body
    assert.equal(details.before_data.title, 'Учить Go 30 минут')
    for (const base of [url, coreUrl]) {
      const backup = await fetch(base + '/api/export').then((r) => r.json())
      assert.equal(backup.version, 3)
      for (const table of dataTables) assert.ok(Array.isArray(backup[table]), table)
      assert.equal(backup.operation_templates[0].id, template.id)
      assert.ok(backup.activity_log.some((x: any) => x.action === 'delete' && x.before_data?.title === 'Учить Go 30 минут'))
      assert.equal(backup.activity_log_baselines.length, dataTables.length)
      assert.equal(backup.history.version, 1)
      assert.equal(backup.activity_log.at(-1).action, 'export')
    }
    // Cursor pagination does not lose or duplicate entries, even with full pages.
    for (let i = 0; i < 55; i++) await db.query(`INSERT INTO app_settings(key,value) VALUES($1,$2)`, [`pagination-${i}`, JSON.stringify({ i })])
    const first = (await request('/api/activity')).body
    assert.equal(first.entries.length, 50)
    const second = (await request(`/api/activity?before=${first.nextBefore}`)).body
    assert.ok(second.entries.length)
    assert.ok(BigInt(second.entries[0].id) < BigInt(first.entries.at(-1).id))
    assert.equal(new Set([...first.entries, ...second.entries].map((x) => String(x.id))).size, first.entries.length + second.entries.length)
  } finally {
    await Promise.all([server, core].map((s) => new Promise<void>((resolve) => s.close(() => resolve()))))
    await db.end()
  }
  db = await testDatabase(directory)
  try {
    const historyBefore = (await db.query(`SELECT COUNT(*)::int AS n FROM activity_log`)).rows[0].n
    await migrate(db)
    assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM activity_log`)).rows[0].n, historyBefore)
    assert.ok((await db.query(`SELECT * FROM activity_log WHERE action='delete'`)).rows.length)
  } finally { await db.end(); await rm(directory, { recursive: true, force: true }) }
})
