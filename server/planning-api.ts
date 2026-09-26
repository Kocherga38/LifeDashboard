import express from 'express'
import type { ErrorRequestHandler } from 'express'
import { randomUUID } from 'node:crypto'
import type { DB } from './database.js'
import { validDate } from '../shared/journals.js'

const validId = (id: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
const text = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value.length <= max
const optional = (value: unknown, max: number) => typeof value === 'string' && value.length <= max
const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 999999999.99
const fields = {
  events: `id,title,to_char(event_date,'YYYY-MM-DD') AS date,event_time AS time,place,note,reflection`,
  'planned-shifts': `id,to_char(shift_date,'YYYY-MM-DD') AS date,expected_pay::float AS "expectedPay",note,received`,
  'meal-notes': `id,to_char(entry_date,'YYYY-MM-DD') AS date,meal,description`,
  'speaking-sessions': `id,to_char(session_date,'YYYY-MM-DD') AS date,minutes,partner,phrases,note`
}
const tables = { events: 'calendar_events', 'planned-shifts': 'planned_shifts', 'meal-notes': 'meal_notes', 'speaking-sessions': 'speaking_sessions' } as const

type Kind = keyof typeof tables
function input(kind: Kind, raw: Record<string, unknown> | undefined) {
  const b = raw ?? {}
  if (!validDate(b.date)) throw new Error('Укажи корректную дату.')
  if (kind === 'events') {
    const { title, time = '', place = '', note = '', reflection = '' } = b
    if (!text(title, 200) || !optional(time, 5) || (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) || !optional(place, 200) || !optional(note, 5000) || !optional(reflection, 5000)) throw new Error('Проверь название, время и описание события.')
    return [b.date, String(title).trim(), time, String(place).trim(), String(note).trim(), String(reflection).trim()]
  }
  if (kind === 'planned-shifts') {
    const { expectedPay, note = '', received = false } = b
    if (!amount(expectedPay) || !optional(note, 1000) || typeof received !== 'boolean') throw new Error('Укажи ожидаемую чистую оплату смены.')
    return [b.date, expectedPay, String(note).trim(), received]
  }
  if (kind === 'meal-notes') {
    const { meal = '', description } = b
    if (!optional(meal, 40) || !text(description, 5000)) throw new Error('Опиши, что ты ел.')
    return [b.date, String(meal).trim(), String(description).trim()]
  }
  const { minutes, partner = '', phrases = '', note = '' } = b
  if (!Number.isInteger(minutes) || Number(minutes) < 1 || Number(minutes) > 600 || !optional(partner, 120) || !optional(phrases, 3000) || !optional(note, 3000)) throw new Error('Проверь длительность и заметки о разговоре.')
  return [b.date, minutes, String(partner).trim(), String(phrases).trim(), String(note).trim()]
}
const columns = {
  events: 'event_date,title,event_time,place,note,reflection',
  'planned-shifts': 'shift_date,expected_pay,note,received',
  'meal-notes': 'entry_date,meal,description',
  'speaking-sessions': 'session_date,minutes,partner,phrases,note'
}
const dateColumn = { events: 'event_date', 'planned-shifts': 'shift_date', 'meal-notes': 'entry_date', 'speaking-sessions': 'session_date' }

export function createPlanningApi(db: DB) {
  const app = express()
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.headers.host}`) {
      res.status(403).json({ error: 'Запрос с другого сайта отклонён.' })
      return
    }
    next()
  })
  app.use(express.json({ limit: '2mb' }))
  for (const kind of Object.keys(tables) as Kind[]) {
    const table = tables[kind], names = columns[kind], selection = fields[kind]
    app.get(`/api/${kind}`, async (req, res) => {
      const from = req.query.from, to = req.query.to
      if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) throw new Error('Некорректный период.')
      const clauses = [from ? `${dateColumn[kind]} >= $1::date` : '', to ? `${dateColumn[kind]} <= $${from ? 2 : 1}::date` : ''].filter(Boolean)
      const values = [from, to].filter(Boolean)
      res.json((await db.query(`SELECT ${selection} FROM ${table} ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY ${dateColumn[kind]} DESC,created_at DESC,id`, values)).rows)
    })
    app.post(`/api/${kind}`, async (req, res) => {
      const values = input(kind, req.body)
      const args = values.map((_, i) => `$${i + 2}${i === 0 ? '::date' : ''}`).join(',')
      const row = (await db.query(`INSERT INTO ${table}(id,${names}) VALUES($1,${args}) RETURNING ${selection}`, [randomUUID(), ...values])).rows[0]
      res.status(201).json(row)
    })
    app.put(`/api/${kind}/:id`, async (req, res) => {
      const id = String(req.params.id)
      if (!validId(id)) throw new Error('Некорректный ID.')
      const values = input(kind, req.body)
      const assignments = names.split(',').map((name, i) => `${name}=$${i + 2}${i === 0 ? '::date' : ''}`).join(',')
      const result = await db.query(`UPDATE ${table} SET ${assignments} WHERE id=$1 RETURNING ${selection}`, [id, ...values])
      if (!result.rows.length) { res.status(404).json({ error: 'Запись не найдена.' }); return }
      res.json(result.rows[0])
    })
    app.delete(`/api/${kind}/:id`, async (req, res) => {
      const id = String(req.params.id)
      if (!validId(id)) throw new Error('Некорректный ID.')
      const result = await db.query(`DELETE FROM ${table} WHERE id=$1 RETURNING id`, [id])
      if (!result.rows.length) { res.status(404).json({ error: 'Запись не найдена.' }); return }
      res.status(204).end()
    })
  }
  app.get('/api/weekly-reflections', async (req, res) => {
    const from = req.query.from
    if (from && !validDate(from)) throw new Error('Некорректная дата недели.')
    res.json((await db.query(`SELECT to_char(week_start,'YYYY-MM-DD') AS "weekStart",wins,friction,next_step AS "nextStep" FROM weekly_reflections ${from ? 'WHERE week_start=$1::date' : ''} ORDER BY week_start DESC`, from ? [from] : [])).rows)
  })
  app.put('/api/weekly-reflections/:date', async (req, res) => {
    const date = String(req.params.date)
    const { wins = '', friction = '', nextStep = '' } = req.body ?? {}
    if (!validDate(date) || new Date(`${date}T12:00:00Z`).getUTCDay() !== 1 || !optional(wins, 5000) || !optional(friction, 5000) || !optional(nextStep, 5000)) throw new Error('Проверь неделю и текст итогов.')
    const row = (await db.query(`INSERT INTO weekly_reflections(week_start,wins,friction,next_step) VALUES($1::date,$2,$3,$4) ON CONFLICT(week_start) DO UPDATE SET wins=$2,friction=$3,next_step=$4 RETURNING to_char(week_start,'YYYY-MM-DD') AS "weekStart",wins,friction,next_step AS "nextStep"`, [date, wins.trim(), friction.trim(), nextStep.trim()])).rows[0]
    res.json(row)
  })
  app.get('/api/finance-settings', async (_req, res) => {
    res.json((await db.query(`SELECT value FROM app_settings WHERE key='finance-plan'`)).rows[0]?.value ?? null)
  })
  app.put('/api/finance-settings', async (req, res) => {
    const { balance, netPerShift, shiftsPerMonth, monthlySpending, rent, rentDay, savingsTarget, purchasePrice } = req.body ?? {}
    if (![balance, netPerShift, monthlySpending, rent, savingsTarget, purchasePrice].every(amount) || !Number.isInteger(shiftsPerMonth) || shiftsPerMonth < 0 || shiftsPerMonth > 31 || !Number.isInteger(rentDay) || rentDay < 1 || rentDay > 31) throw new Error('Проверь суммы, число смен и день оплаты квартиры.')
    const value = { balance, netPerShift, shiftsPerMonth, monthlySpending, rent, rentDay, savingsTarget, purchasePrice }
    await db.query(`INSERT INTO app_settings(key,value) VALUES('finance-plan',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(value)])
    res.json(value)
  })
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error(error.message)
    const known = !error.code && !error.syscall
    res.status(error.type === 'entity.parse.failed' ? 400 : known ? 400 : 503).json({ error: known ? error.message : 'Не удалось выполнить запрос. Проверь PostgreSQL и повтори.' })
  }
  app.use(errors)
  return app
}
