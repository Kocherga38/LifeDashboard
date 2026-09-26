import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { testDatabase } from './db.js'
import { migrate } from '../server/database.js'
import { createPlanningApi } from '../server/planning-api.js'
import { createPersonalApi } from '../server/personal-api.js'

test('события, смены, свободная еда, разговоры и итог недели сохраняются и экспортируются', async () => {
  const db = await testDatabase()
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
  try {
    const event = await request('/api/events', 'POST', { date: '2026-09-28', title: 'Speaking Club', time: '19:00', place: 'Циферблат', note: 'Прийти вовремя', reflection: '' })
    assert.equal(event.status, 201)
    assert.equal((await request('/api/events?from=2026-09-28&to=2026-09-28')).body.length, 1)
    assert.equal((await request('/api/events?from=2026-09-29&to=2026-09-30')).body.length, 0)
    assert.equal((await request('/api/events', 'POST', { date: '2026-09-28', title: 'Bad', time: '25:00' })).status, 400)
    assert.equal((await request(`/api/events/${event.body.id}`, 'PUT', { date: '2026-09-28', title: 'Speaking Club', time: '19:00', place: 'Циферблат', note: '', reflection: 'Познакомился с людьми' })).body.reflection, 'Познакомился с людьми')

    const shift = await request('/api/planned-shifts', 'POST', { date: '2026-09-27', expectedPay: 4600, note: 'Склад' })
    assert.equal(shift.status, 201)
    assert.equal(shift.body.expectedPay, 4600)
    assert.equal(shift.body.received, false)
    assert.equal((await request(`/api/planned-shifts/${shift.body.id}`, 'PUT', { date: '2026-09-27', expectedPay: 4600, note: 'Склад', received: true })).body.received, true)
    assert.equal((await request('/api/planned-shifts', 'POST', { date: '2026-09-27', expectedPay: -1 })).status, 400)
    const meal = await request('/api/meal-notes', 'POST', { date: '2026-09-26', meal: 'Обед', description: 'Хлеб и яйца, без граммовки' })
    assert.equal(meal.status, 201)
    assert.equal(meal.body.description, 'Хлеб и яйца, без граммовки')
    const speaking = await request('/api/speaking-sessions', 'POST', { date: '2026-09-28', minutes: 60, partner: 'Speaking Club', phrases: 'went by', note: '' })
    assert.equal(speaking.status, 201)
    assert.equal((await request('/api/speaking-sessions', 'POST', { date: '2026-09-28', minutes: 0 })).status, 400)
    const reflection = await request('/api/weekly-reflections/2026-09-21', 'PUT', { wins: 'Работал', friction: 'Мало сна', nextStep: 'Лечь раньше' })
    assert.equal(reflection.status, 200)
    assert.equal((await request('/api/weekly-reflections?from=2026-09-21')).body[0].nextStep, 'Лечь раньше')
    assert.equal((await request('/api/weekly-reflections/2026-09-22', 'PUT', { wins: '' })).status, 400)
    const settings = { balance: 10000, netPerShift: 4600, shiftsPerMonth: 12, monthlySpending: 15000, rent: 20000, rentDay: 1, savingsTarget: 100000, purchasePrice: 40000 }
    assert.deepEqual((await request('/api/finance-settings', 'PUT', settings)).body, settings)
    assert.deepEqual((await request('/api/finance-settings')).body, settings)
    const backup = (await request('/api/export')).body
    assert.equal(backup.calendar_events[0].title, 'Speaking Club')
    assert.equal(backup.planned_shifts.length, 1)
    assert.equal(backup.meal_notes.length, 1)
    assert.equal(backup.speaking_sessions.length, 1)
    assert.equal(backup.weekly_reflections.length, 1)
    assert.equal(backup.app_settings.find((x: { key: string }) => x.key === 'finance-plan').value.balance, 10000)
    assert.equal((await request(`/api/events/${event.body.id}`, 'DELETE')).status, 204)
    assert.equal((await request('/api/events')).body.length, 0)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await db.end()
  }
})
