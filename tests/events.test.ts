import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { testDatabase } from './db.js'
import { migrate } from '../server/database.js'
import { createPlanningApi } from '../server/planning-api.js'
import { createPersonalApi } from '../server/personal-api.js'
import { expandEvents } from '../shared/events.js'
import type { CalendarEvent } from '../shared/events.js'

test('цикл 2/2 сохраняет фазу через границы месяца, года и високосный день', () => {
  const event: CalendarEvent = { id: 'series', date: '2024-02-27', title: 'Работа', time: '', place: '', note: '', reflection: '', recurrence: { type: 'cycle', workDays: 2, offDays: 2 } }
  const dates = (start: string, from: string, to: string) => expandEvents([{ ...event, date: start }], from, to).map((x) => x.date).sort()
  assert.deepEqual(dates(event.date, '2024-02-26', '2024-03-05'), ['2024-02-27', '2024-02-28', '2024-03-02', '2024-03-03'])
  assert.deepEqual(dates('2026-12-30', '2027-01-01', '2027-01-07'), ['2027-01-03', '2027-01-04', '2027-01-07'])
  assert.deepEqual(dates('2026-10-23', '2026-10-24', '2026-10-30'), ['2026-10-24', '2026-10-27', '2026-10-28'])
})

test('миграция сохраняет старые события; повторения доступны в календаре, изменяются и экспортируются', async () => {
  const db = await testDatabase()
  // Reproduce the previous schema with an existing event before applying migration.
  await db.query(`CREATE TABLE calendar_events(id UUID PRIMARY KEY,event_date DATE NOT NULL,title VARCHAR(200) NOT NULL,event_time VARCHAR(5) NOT NULL DEFAULT '',place VARCHAR(200) NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',reflection TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
  const oldId = randomUUID()
  await db.query(`INSERT INTO calendar_events(id,event_date,title) VALUES($1,'2026-10-01','Старое событие')`, [oldId])
  await migrate(db)
  await migrate(db)
  const app = express()
  app.use(createPersonalApi(db))
  app.use(createPlanningApi(db))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  async function request(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: response.status === 204 ? null : await response.json() }
  }
  const period = '/api/events?from=2026-10-01&to=2026-10-12'
  const input = { date: '2026-10-01', title: 'Работа подруги', time: '09:00', place: 'Работа', note: '2/2', reflection: '', recurrence: { type: 'cycle', workDays: 2, offDays: 2, until: '2026-10-09' } }
  try {
    assert.equal((await request(period)).body[0].id, oldId)
    assert.equal((await request(period)).body[0].recurrence, null)
    const created = await request('/api/events', 'POST', input)
    assert.equal(created.status, 201)
    const id = created.body.id
    assert.deepEqual(created.body.recurrence, input.recurrence)
    const series = (await request(period)).body.filter((x: CalendarEvent) => x.id === id)
    assert.deepEqual(series.map((x: CalendarEvent) => x.date).sort(), ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-09'])
    assert.ok(series.every((x: CalendarEvent) => x.startDate === input.date && x.time === input.time && x.note === input.note))
    assert.equal((await request('/api/events?from=2026-10-06&to=2026-10-06')).body[0].id, id)
    assert.equal((await request('/api/events?from=2026-09-01&to=2026-09-30')).body.length, 0)
    assert.equal((await request('/api/events?from=2026-11-01&to=2026-11-30')).body.length, 0)
    const backup = (await request('/api/export')).body.calendar_events.find((x: { id: string }) => x.id === id)
    assert.deepEqual(backup.recurrence, input.recurrence)
    // Older clients that omit recurrence must not erase an existing schedule.
    const { recurrence: _recurrence, ...oldClient } = input
    assert.deepEqual((await request(`/api/events/${id}`, 'PUT', { ...oldClient, title: 'Обновлено' })).body.recurrence, input.recurrence)
    assert.deepEqual((await request(`/api/events/${id}`, 'PUT', { ...input, recurrence: { type: 'interval', intervalDays: 3 } })).body.recurrence, { type: 'interval', intervalDays: 3 })
    assert.deepEqual((await request(period)).body.filter((x: CalendarEvent) => x.id === id).map((x: CalendarEvent) => x.date).sort(), ['2026-10-01', '2026-10-04', '2026-10-07', '2026-10-10'])
    await request(`/api/events/${id}`, 'PUT', { ...input, date: '2026-10-02', recurrence: { type: 'weekdays', weekdays: [0, 4, 0], until: '2026-10-12' } })
    assert.deepEqual((await request(period)).body.filter((x: CalendarEvent) => x.id === id).map((x: CalendarEvent) => x.date).sort(), ['2026-10-02', '2026-10-05', '2026-10-09', '2026-10-12'])
    for (const recurrence of [{ type: 'cycle', workDays: 0, offDays: 2 }, { type: 'cycle', workDays: 2, offDays: 1.5 }, { type: 'interval', intervalDays: 366 }, { type: 'interval', intervalDays: '2' }, { type: 'weekdays', weekdays: [] }, { type: 'weekdays', weekdays: [7] }, { type: 'cycle', workDays: 2, offDays: 2, until: '2026-09-30' }, { type: 'cycle', workDays: 2, offDays: 2, until: '2026-02-30' }, [], 'daily']) {
      assert.equal((await request('/api/events', 'POST', { ...input, recurrence })).status, 400)
      assert.equal((await request(`/api/events/${id}`, 'PUT', { ...input, recurrence })).status, 400)
    }
    assert.equal((await request('/api/events?from=2026-10-12&to=2026-10-01')).status, 400)
    assert.equal((await request(`/api/events/${id}`, 'PUT', { ...input, recurrence: null })).body.recurrence, null)
    assert.equal((await request(period)).body.filter((x: CalendarEvent) => x.id === id).length, 1)
    await request(`/api/events/${id}`, 'PUT', { ...input, recurrence: { type: 'cycle', workDays: 2, offDays: 2 } })
    assert.equal((await request('/api/events')).body.length, 2) // series, not infinite duplicated rows
    assert.equal((await request(`/api/events/${id}`, 'DELETE')).status, 204)
    assert.deepEqual((await request(period)).body.map((x: CalendarEvent) => x.id), [oldId])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await db.end()
  }
})
