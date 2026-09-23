import express from 'express'
import type { ErrorRequestHandler } from 'express'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { DB } from './database.js'
import { isKind, validateEntry, validDate, nutrients } from '../shared/journals.js'
import { defaultOperationCategories } from '../shared/operationCategories.js'

const operationFields = `id,title,amount,category,type,subcategory,counterparty,note,to_char(operation_date,'YYYY-MM-DD') AS date`
const budgetFields = `id,category,amount,to_char(month,'YYYY-MM') AS month`
const templateFields = `id,title,amount,category,type,subcategory,counterparty,note,template_kind AS "templateKind",recurrence,to_char(next_date,'YYYY-MM-DD') AS "nextDate"`
const serial = (r: Record<string, unknown>) => ({ ...r, amount: Number(r.amount) })
const idValid = (s: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s)
const monthValid = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}$/.test(s) && validDate(`${s}-01`)
const textValid = (s: unknown, max = 100): s is string =>
  typeof s === 'string' && !!s.trim() && s.length <= max
const amountValid = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0.01 && n <= 999999999.99
const sidebarSections = [
  'today','weekly','goals','operations','analytics','calendar','notes','diary','flashcards',
  'habits','shifts','weights','measurements','meals','products','workouts','data'
]
const sidebarSectionSet = new Set(sidebarSections)

function sidebarOrderInput(raw: unknown) {
  if (
    !Array.isArray(raw) ||
    raw.length !== sidebarSections.length ||
    raw.some((key) => typeof key !== 'string' || !sidebarSectionSet.has(key)) ||
    new Set(raw).size !== raw.length
  ) throw new Error('Некорректный порядок разделов.')
  return raw as string[]
}

type RecurrenceType = 'none' | 'interval' | 'weekdays'
type Recurrence = { type: RecurrenceType; intervalDays?: number; weekdays?: number[] }
const taskColors = new Set(['default','red','orange','yellow','green','blue','purple','pink','gray'])
const taskColorInput = (raw: unknown) => {
  const color = raw == null ? 'default' : String(raw)
  if (!taskColors.has(color)) throw new Error('Некорректный цвет задачи.')
  return color
}
const dateMs = (value: string) => {
  const [y, m, d] = value.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const dateFromMs = (value: number) => new Date(value).toISOString().slice(0, 10)
const daysBetween = (from: string, to: string) => Math.round((dateMs(to) - dateMs(from)) / 86400000)
const mondayIndex = (value: string) => (new Date(dateMs(value)).getUTCDay() + 6) % 7
function recurrenceInput(raw: unknown): Recurrence {
  if (raw == null) return { type: 'none' }
  const r = raw as Record<string, unknown>
  if (!['none', 'interval', 'weekdays'].includes(String(r.type)))
    throw new Error('Некорректное повторение задачи.')
  const type = String(r.type) as RecurrenceType
  if (type === 'none') return { type }
  if (type === 'interval') {
    const n = Number(r.intervalDays)
    if (!Number.isInteger(n) || n < 1 || n > 365) throw new Error('Интервал должен быть от 1 до 365 дней.')
    return { type, intervalDays: n }
  }
  if (!Array.isArray(r.weekdays)) throw new Error('Выбери дни недели для повторения.')
  const weekdays = [...new Set(r.weekdays.map(Number))].sort((a, b) => a - b)
  if (!weekdays.length || weekdays.some((n) => !Number.isInteger(n) || n < 0 || n > 6))
    throw new Error('Выбери хотя бы один корректный день недели.')
  return { type, weekdays }
}
function recurrenceFromRow(row: Record<string, any>): Recurrence | null {
  if (row.recurrence_type === 'interval') return { type: 'interval', intervalDays: Number(row.interval_days) }
  if (row.recurrence_type === 'weekdays') {
    const value = Array.isArray(row.weekdays) ? row.weekdays : JSON.parse(String(row.weekdays ?? '[]'))
    return { type: 'weekdays', weekdays: value.map(Number) }
  }
  return null
}
function occursOn(row: Record<string, any>, date: string) {
  const start = String(row.date)
  if (date < start) return false
  if (row.recurrence_type === 'interval') {
    const n = Number(row.interval_days)
    return n > 0 && daysBetween(start, date) % n === 0
  }
  if (row.recurrence_type === 'weekdays') {
    const value = Array.isArray(row.weekdays) ? row.weekdays : JSON.parse(String(row.weekdays ?? '[]'))
    return value.map(Number).includes(mondayIndex(date))
  }
  return date === start
}
function operationInput(raw: unknown) {
  const b = raw as Record<string, unknown> | null
  if (
    !b ||
    !textValid(b.title) ||
    !textValid(b.category) ||
    !amountValid(b.amount) ||
    !validDate(b.date) ||
    !['expense', 'income'].includes(String(b.type))
  )
    throw new Error('Проверь название, сумму, категорию, тип и дату.')
  for (const key of ['note', 'counterparty', 'subcategory'])
    if (b[key] !== undefined && (typeof b[key] !== 'string' || (b[key] as string).length > 5000))
      throw new Error('Слишком длинный комментарий или реквизиты.')
  return {
    title: b.title.trim(),
    category: b.category.trim(),
    amount: b.amount,
    date: b.date,
    type: String(b.type),
    note: String(b.note ?? ''),
    subcategory: String(b.subcategory ?? ''),
    counterparty: String(b.counterparty ?? '')
  }
}
function templateInput(raw: unknown) {
  const operation = operationInput({ ...(raw as object), date: '2000-01-01' })
  const b = raw as Record<string, unknown>
  if (!['quick', 'recurring'].includes(String(b.templateKind)))
    throw new Error('Выбери тип шаблона.')
  const templateKind = b.templateKind === 'recurring' ? 'recurring' : 'quick'
  const recurrence = templateKind === 'recurring' ? String(b.recurrence ?? '') : null
  const nextDate = templateKind === 'recurring' ? b.nextDate : null
  if (
    templateKind === 'recurring' &&
    (!['weekly', 'monthly', 'yearly'].includes(String(recurrence)) || !validDate(nextDate))
  )
    throw new Error('Для регулярного шаблона выбери периодичность и следующую дату.')
  return { ...operation, templateKind, recurrence, nextDate }
}
function nextRecurringDate(date: string, recurrence: string) {
  const [year, month, day] = date.split('-').map(Number)
  if (recurrence === 'weekly') {
    const d = new Date(Date.UTC(year, month - 1, day + 7))
    return d.toISOString().slice(0, 10)
  }
  const targetMonth = recurrence === 'yearly' ? month - 1 : month
  const targetYear = recurrence === 'yearly' ? year + 1 : year + Math.floor(targetMonth / 12)
  const normalizedMonth = targetMonth % 12
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
  return new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10)
}
async function bundle() {
  return JSON.parse(await readFile(new URL('../data/excel-import.json', import.meta.url), 'utf8'))
}
export function createApi(db: DB) {
  const app = express()
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    // Локальный API принимает изменения только со страницы своего приложения.
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== `${req.protocol}://${req.headers.host}`
    ) {
      res.status(403).json({ error: 'Запрос с другого сайта отклонён.' })
      return
    }
    next()
  })
  app.use(express.json({ limit: '2mb' }))
  app.get('/api/operation-categories', async (_req, res) => {
    res.json((await db.query(`SELECT id,name,type FROM operation_categories ORDER BY type,name,id`)).rows)
  })
  app.post('/api/operation-categories', async (req, res) => {
    const { name, type } = req.body ?? {}
    if (!textValid(name) || !['expense','income'].includes(type))
      throw new Error('Проверь название и тип категории.')
    const value = name.trim()
    const defaults = defaultOperationCategories[type as 'expense' | 'income']
    if (defaults.some((item) => item.toLocaleLowerCase('ru') === value.toLocaleLowerCase('ru'))) {
      res.status(409).json({ error: 'Такая категория уже есть.' })
      return
    }
    const result = await db.query(
      `INSERT INTO operation_categories(id,name,type) VALUES($1,$2,$3)
       ON CONFLICT DO NOTHING RETURNING id,name,type`, [randomUUID(), value, type]
    )
    if (!result.rows.length) { res.status(409).json({ error: 'Такая категория уже есть.' }); return }
    res.status(201).json(result.rows[0])
  })
  app.get('/api/expenses', async (_req, res) =>
    res.json(
      (
        await db.query(
          `SELECT ${operationFields} FROM expenses ORDER BY operation_date DESC,created_at DESC,id DESC`
        )
      ).rows.map(serial)
    )
  )
  app.post('/api/expenses', async (req, res) => {
    const b = operationInput(req.body)
    const r = await db.query(
      `INSERT INTO expenses(id,title,amount,category,type,operation_date,subcategory,counterparty,note) VALUES($1,$2,$3,$4,$5,$6::date,$7,$8,$9) RETURNING ${operationFields}`,
      [
        randomUUID(),
        b.title,
        b.amount.toFixed(2),
        b.category,
        b.type,
        b.date,
        b.subcategory,
        b.counterparty,
        b.note
      ]
    )
    res.status(201).json(serial(r.rows[0]))
  })
  app.put('/api/expenses/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!idValid(id)) throw new Error('Некорректный ID.')
    const b = operationInput(req.body)
    // Старые клиенты не стирают дополнительные поля импортированных записей.
    const r = await db.query(
      `UPDATE expenses SET title=$1,amount=$2,category=$3,type=$4,operation_date=$5::date,subcategory=COALESCE($7,subcategory),counterparty=COALESCE($8,counterparty),note=COALESCE($9,note) WHERE id=$6 RETURNING ${operationFields}`,
      [
        b.title,
        b.amount.toFixed(2),
        b.category,
        b.type,
        b.date,
        id,
        req.body.subcategory ?? null,
        req.body.counterparty ?? null,
        req.body.note ?? null
      ]
    )
    if (!r.rows.length) {
      res.status(404).json({ error: 'Операция уже удалена. Обнови список.' })
      return
    }
    res.json(serial(r.rows[0]))
  })
  app.delete('/api/expenses/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!idValid(id)) throw new Error('Некорректный ID.')
    await db.query('DELETE FROM expenses WHERE id=$1', [id])
    res.status(204).end()
  })
  app.get('/api/templates', async (_req, res) =>
    res.json(
      (
        await db.query(
          `SELECT ${templateFields} FROM operation_templates ORDER BY template_kind,next_date NULLS LAST,created_at`
        )
      ).rows.map(serial)
    )
  )
  app.post('/api/templates', async (req, res) => {
    const b = templateInput(req.body)
    const r = await db.query(
      `INSERT INTO operation_templates(id,title,amount,category,type,subcategory,counterparty,note,template_kind,recurrence,next_date)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date) RETURNING ${templateFields}`,
      [
        randomUUID(),
        b.title,
        b.amount.toFixed(2),
        b.category,
        b.type,
        b.subcategory,
        b.counterparty,
        b.note,
        b.templateKind,
        b.recurrence,
        b.nextDate
      ]
    )
    res.status(201).json(serial(r.rows[0]))
  })
  app.put('/api/templates/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!idValid(id)) throw new Error('Некорректный ID.')
    const b = templateInput(req.body)
    const r = await db.query(
      `UPDATE operation_templates SET title=$1,amount=$2,category=$3,type=$4,subcategory=$5,counterparty=$6,note=$7,template_kind=$8,recurrence=$9,next_date=$10::date
       WHERE id=$11 RETURNING ${templateFields}`,
      [
        b.title,
        b.amount.toFixed(2),
        b.category,
        b.type,
        b.subcategory,
        b.counterparty,
        b.note,
        b.templateKind,
        b.recurrence,
        b.nextDate,
        id
      ]
    )
    if (!r.rows.length) {
      res.status(404).json({ error: 'Шаблон не найден.' })
      return
    }
    res.json(serial(r.rows[0]))
  })
  app.delete('/api/templates/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!idValid(id)) throw new Error('Некорректный ID.')
    await db.query('DELETE FROM operation_templates WHERE id=$1', [id])
    res.status(204).end()
  })
  app.post('/api/templates/:id/use', async (req, res) => {
    const id = String(req.params.id)
    if (!idValid(id)) throw new Error('Некорректный ID.')
    const date = req.body?.date
    if (!validDate(date)) throw new Error('Некорректная дата операции.')
    const c = await db.connect()
    try {
      await c.query('BEGIN')
      const template = (
        await c.query(`SELECT ${templateFields} FROM operation_templates WHERE id=$1 FOR UPDATE`, [
          id
        ])
      ).rows[0]
      if (!template) {
        await c.query('ROLLBACK')
        res.status(404).json({ error: 'Шаблон не найден.' })
        return
      }
      const operation = (
        await c.query(
          `INSERT INTO expenses(id,title,amount,category,type,operation_date,subcategory,counterparty,note)
           VALUES($1,$2,$3,$4,$5,$6::date,$7,$8,$9) RETURNING ${operationFields}`,
          [
            randomUUID(),
            template.title,
            template.amount,
            template.category,
            template.type,
            date,
            template.subcategory,
            template.counterparty,
            template.note
          ]
        )
      ).rows[0]
      let updatedTemplate = template
      if (template.templateKind === 'recurring') {
        const nextDate = nextRecurringDate(String(template.nextDate), String(template.recurrence))
        updatedTemplate = (
          await c.query(
            `UPDATE operation_templates SET next_date=$1::date WHERE id=$2 RETURNING ${templateFields}`,
            [nextDate, id]
          )
        ).rows[0]
      }
      await c.query('COMMIT')
      res.status(201).json({ operation: serial(operation), template: serial(updatedTemplate) })
    } catch (error) {
      await c.query('ROLLBACK')
      throw error
    } finally {
      c.release()
    }
  })
  app.get('/api/budgets', async (req, res) => {
    if (!monthValid(req.query.month)) throw new Error('Выбери месяц.')
    res.json(
      (
        await db.query(
          `SELECT ${budgetFields} FROM budgets WHERE month=$1::date ORDER BY category`,
          [`${req.query.month}-01`]
        )
      ).rows.map(serial)
    )
  })
  app.put('/api/budgets', async (req, res) => {
    const { category, amount, month } = req.body ?? {}
    if (!textValid(category) || !amountValid(amount) || !monthValid(month))
      throw new Error('Проверь категорию, положительный лимит и месяц.')
    res.json(
      serial(
        (
          await db.query(
            `INSERT INTO budgets(id,category,amount,month) VALUES($1,$2,$3,$4::date) ON CONFLICT(month,category) DO UPDATE SET amount=EXCLUDED.amount RETURNING ${budgetFields}`,
            [randomUUID(), category.trim(), amount.toFixed(2), `${month}-01`]
          )
        ).rows[0]
      )
    )
  })
  app.delete('/api/budgets/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!idValid(id)) throw new Error('Некорректный ID.')
    await db.query('DELETE FROM budgets WHERE id=$1', [id])
    res.status(204).end()
  })

  app.get('/api/journal/:kind', async (req, res) => {
    const kind = String(req.params.kind)
    if (!isKind(kind)) throw new Error('Неизвестный раздел.')
    const r = await db.query(
      `SELECT id,data FROM journal_entries WHERE kind=$1 ORDER BY data->>'date' DESC,created_at DESC`,
      [kind]
    )
    res.json(r.rows.map((row) => ({ ...row.data, id: row.id })))
  })
  app.post('/api/journal/:kind', async (req, res) => {
    const kind = String(req.params.kind)
    if (!isKind(kind)) throw new Error('Неизвестный раздел.')
    const data = validateEntry(kind, req.body)
    const id = randomUUID()
    await db.query(`INSERT INTO journal_entries(id,kind,data) VALUES($1,$2,$3::jsonb)`, [
      id,
      kind,
      JSON.stringify(data)
    ])
    res.status(201).json({ ...data, id })
  })
  app.put('/api/journal/:kind/:id', async (req, res) => {
    const kind = String(req.params.kind),
      id = String(req.params.id)
    if (!isKind(kind) || !idValid(id)) throw new Error('Некорректный раздел или ID.')
    const data = validateEntry(kind, req.body)
    const r = await db.query(
      `UPDATE journal_entries SET data=$1::jsonb WHERE id=$2 AND kind=$3 RETURNING id`,
      [JSON.stringify(data), id, kind]
    )
    if (!r.rows.length) {
      res.status(404).json({ error: 'Запись не найдена.' })
      return
    }
    res.json({ ...data, id })
  })
  app.delete('/api/journal/:kind/:id', async (req, res) => {
    const kind = String(req.params.kind),
      id = String(req.params.id)
    if (!isKind(kind) || !idValid(id)) throw new Error('Некорректный раздел или ID.')
    await db.query('DELETE FROM journal_entries WHERE id=$1 AND kind=$2', [id, kind])
    res.status(204).end()
  })
  app.get('/api/tasks', async (req, res) => {
    const from = req.query.from,
      to = req.query.to
    if (!validDate(from) || !validDate(to) || String(from) > String(to))
      throw new Error('Выбери корректный период календаря.')
    const rows = (
      await db.query(
        `SELECT id,title,to_char(task_date,'YYYY-MM-DD') AS date,completed,recurrence_type,interval_days,weekdays,color,created_at
         FROM tasks
         WHERE (recurrence_type='none' AND task_date BETWEEN $1::date AND $2::date)
            OR (recurrence_type<>'none' AND task_date <= $2::date)
         ORDER BY task_date,created_at,id`,
        [from, to]
      )
    ).rows
    const hasRecurring = rows.some((r) => r.recurrence_type !== 'none')
    const completionRows = hasRecurring
      ? (
          await db.query(
            `SELECT task_id,
                    to_char(occurrence_date,'YYYY-MM-DD') AS "occurrenceDate",
                    to_char(moved_to_date,'YYYY-MM-DD') AS "movedToDate",
                    completed
             FROM task_occurrences
             WHERE occurrence_date BETWEEN $1::date AND $2::date
                OR moved_to_date BETWEEN $1::date AND $2::date`,
            [from, to]
          )
        ).rows
      : []
    const occurrences = new Map(completionRows.map((r) => [`${r.task_id}:${r.occurrenceDate}`, r]))
    const result: Record<string, unknown>[] = []
    for (const row of rows) {
      const recurrence = recurrenceFromRow(row)
      if (!recurrence) {
        result.push({ id: row.id, title: row.title, date: row.date, startDate: row.date, completed: Boolean(row.completed), recurrence: null, color: row.color })
        continue
      }
      for (let ms = dateMs(String(from)); ms <= dateMs(String(to)); ms += 86400000) {
        const date = dateFromMs(ms)
        if (!occursOn(row, date)) continue
        const occurrence = occurrences.get(`${row.id}:${date}`)
        if (occurrence?.movedToDate) continue
        result.push({
          id: row.id,
          title: row.title,
          date,
          startDate: row.date,
          occurrenceDate: date,
          completed: Boolean(occurrence?.completed),
          recurrence,
          color: row.color
        })
      }
      for (const occurrence of completionRows) {
        if (
          occurrence.task_id !== row.id ||
          !occurrence.movedToDate ||
          occurrence.movedToDate < String(from) ||
          occurrence.movedToDate > String(to)
        ) continue
        result.push({
          id: row.id,
          title: row.title,
          date: occurrence.movedToDate,
          startDate: row.date,
          occurrenceDate: occurrence.occurrenceDate,
          completed: Boolean(occurrence.completed),
          recurrence,
          color: row.color
        })
      }
    }
    result.sort((a: any, b: any) => a.date.localeCompare(b.date) || Number(a.completed) - Number(b.completed) || a.title.localeCompare(b.title) || String(a.occurrenceDate ?? '').localeCompare(String(b.occurrenceDate ?? '')))
    res.json(result)
  })
  app.post('/api/tasks', async (req, res) => {
    const title = req.body?.title,
      date = req.body?.date
    if (!textValid(title, 200) || !validDate(date)) throw new Error('Введи задачу и корректную дату.')
    const recurrence = recurrenceInput(req.body?.recurrence)
    const color = taskColorInput(req.body?.color)
    const r = await db.query(
      `INSERT INTO tasks(id,title,task_date,recurrence_type,interval_days,weekdays,color)
       VALUES($1,$2,$3::date,$4,$5,$6::jsonb,$7)
       RETURNING id,title,to_char(task_date,'YYYY-MM-DD') AS date,completed,recurrence_type,interval_days,weekdays,color`,
      [randomUUID(), title.trim(), date, recurrence.type, recurrence.intervalDays ?? null, JSON.stringify(recurrence.weekdays ?? []), color]
    )
    const row = r.rows[0]
    res.status(201).json({
      id: row.id,
      title: row.title,
      date: row.date,
      startDate: row.date,
      completed: Boolean(row.completed),
      recurrence: recurrenceFromRow(row),
      color: row.color
    })
  })
  app.put('/api/tasks/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!idValid(id)) throw new Error('Некорректный ID.')

    if (typeof req.body?.completed === 'boolean') {
      const base = (
        await db.query(
          `SELECT id,title,to_char(task_date,'YYYY-MM-DD') AS date,completed,recurrence_type,interval_days,weekdays,color FROM tasks WHERE id=$1`,
          [id]
        )
      ).rows[0]
      if (!base) {
        res.status(404).json({ error: 'Задача уже удалена.' })
        return
      }
      const recurrence = recurrenceFromRow(base)
      if (!recurrence) {
        const r = await db.query(
          `UPDATE tasks SET completed=$1 WHERE id=$2 RETURNING id,title,to_char(task_date,'YYYY-MM-DD') AS date,completed,recurrence_type,interval_days,weekdays,color`,
          [req.body.completed, id]
        )
        const row = r.rows[0]
        res.json({ id: row.id, title: row.title, date: row.date, startDate: row.date, completed: Boolean(row.completed), recurrence: null, color: row.color })
        return
      }
      const occurrenceDate = req.body?.occurrenceDate ?? req.body?.date
      if (!validDate(occurrenceDate) || !occursOn(base, occurrenceDate)) throw new Error('Некорректная дата повторяющейся задачи.')
      const savedOccurrence = (
        await db.query(
          `SELECT to_char(moved_to_date,'YYYY-MM-DD') AS "movedToDate"
           FROM task_occurrences WHERE task_id=$1 AND occurrence_date=$2::date`,
          [id, occurrenceDate]
        )
      ).rows[0]
      const date = savedOccurrence?.movedToDate ?? occurrenceDate
      if (req.body?.date !== undefined && req.body.date !== date)
        throw new Error('Эта задача уже перенесена. Обнови календарь.')
      await db.query(
        `INSERT INTO task_occurrences(task_id,occurrence_date,completed) VALUES($1,$2::date,$3)
         ON CONFLICT(task_id,occurrence_date) DO UPDATE SET completed=EXCLUDED.completed`,
        [id, occurrenceDate, req.body.completed]
      )
      res.json({ id, title: base.title, date, startDate: base.date, occurrenceDate, completed: req.body.completed, recurrence, color: base.color })
      return
    }

    const title = req.body?.title,
      date = req.body?.date
    if (!textValid(title, 200) || !validDate(date)) throw new Error('Введи задачу и корректную дату.')
    const recurrence = recurrenceInput(req.body?.recurrence)
    const color = taskColorInput(req.body?.color)
    const r = await db.query(
      `UPDATE tasks
       SET title=$1,task_date=$2::date,recurrence_type=$3,interval_days=$4,weekdays=$5::jsonb,color=$6,completed=CASE WHEN $3='none' THEN completed ELSE FALSE END
       WHERE id=$7
       RETURNING id,title,to_char(task_date,'YYYY-MM-DD') AS date,completed,recurrence_type,interval_days,weekdays,color`,
      [title.trim(), date, recurrence.type, recurrence.intervalDays ?? null, JSON.stringify(recurrence.weekdays ?? []), color, id]
    )
    if (!r.rows.length) {
      res.status(404).json({ error: 'Задача уже удалена.' })
      return
    }
    if (recurrence.type === 'none') await db.query('DELETE FROM task_occurrences WHERE task_id=$1', [id])
    const row = r.rows[0]
    res.json({ id: row.id, title: row.title, date: row.date, startDate: row.date, completed: Boolean(row.completed), recurrence: recurrenceFromRow(row), color: row.color })
  })
  app.post('/api/tasks/:id/move', async (req, res) => {
    const id = String(req.params.id)
    const fromDate = req.body?.fromDate,
      toDate = req.body?.toDate
    if (!idValid(id) || !validDate(fromDate) || !validDate(toDate))
      throw new Error('Проверь даты переноса задачи.')
    const base = (
      await db.query(
        `SELECT id,title,to_char(task_date,'YYYY-MM-DD') AS date,completed,recurrence_type,interval_days,weekdays,color
         FROM tasks WHERE id=$1`,
        [id]
      )
    ).rows[0]
    if (!base) {
      res.status(404).json({ error: 'Задача уже удалена.' })
      return
    }
    const recurrence = recurrenceFromRow(base)
    if (!recurrence) {
      if (base.date !== fromDate) throw new Error('Эта задача уже перенесена. Обнови календарь.')
      const row = (
        await db.query(
          `UPDATE tasks SET task_date=$1::date WHERE id=$2
           RETURNING id,title,to_char(task_date,'YYYY-MM-DD') AS date,completed,color`,
          [toDate, id]
        )
      ).rows[0]
      res.json({ id: row.id, title: row.title, date: row.date, startDate: row.date, completed: Boolean(row.completed), recurrence: null, color: row.color })
      return
    }
    if (!occursOn(base, fromDate)) throw new Error('Некорректная дата повторяющейся задачи.')
    const movedToDate = fromDate === toDate ? null : toDate
    const occurrence = (
      await db.query(
        `INSERT INTO task_occurrences(task_id,occurrence_date,moved_to_date)
         VALUES($1,$2::date,$3::date)
         ON CONFLICT(task_id,occurrence_date) DO UPDATE SET moved_to_date=EXCLUDED.moved_to_date
         RETURNING completed`,
        [id, fromDate, movedToDate]
      )
    ).rows[0]
    res.json({
      id,
      title: base.title,
      date: toDate,
      startDate: base.date,
      occurrenceDate: fromDate,
      completed: Boolean(occurrence.completed),
      recurrence,
      color: base.color
    })
  })
  app.delete('/api/tasks/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!idValid(id)) throw new Error('Некорректный ID.')
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const task = (
        await client.query(
          `SELECT id,title,to_char(task_date,'YYYY-MM-DD') AS date,completed,recurrence_type,color
           FROM tasks WHERE id=$1 FOR UPDATE`,
          [id]
        )
      ).rows[0]
      if (task && task.recurrence_type !== 'none') {
        const completed = (
          await client.query(
            `SELECT to_char(COALESCE(moved_to_date,occurrence_date),'YYYY-MM-DD') AS date
             FROM task_occurrences WHERE task_id=$1 AND completed=TRUE`,
            [id]
          )
        ).rows
        for (const occurrence of completed) {
          await client.query(
            `INSERT INTO tasks(id,title,task_date,completed,recurrence_type,color)
             VALUES($1,$2,$3::date,TRUE,'none',$4)`,
            [randomUUID(), task.title, occurrence.date, task.color]
          )
        }
      }
      await client.query('DELETE FROM tasks WHERE id=$1', [id])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    res.status(204).end()
  })

  app.get('/api/sidebar-order', async (_req, res) => {
    const value = (await db.query(`SELECT value FROM app_settings WHERE key='sidebar-order'`)).rows[0]?.value
    const saved = Array.isArray(value)
      ? value.filter((key): key is string => typeof key === 'string' && sidebarSectionSet.has(key))
      : []
    const unique = [...new Set(saved)]
    res.json({ order: [...unique, ...sidebarSections.filter((key) => !unique.includes(key))] })
  })
  app.put('/api/sidebar-order', async (req, res) => {
    const order = sidebarOrderInput(req.body?.order)
    await db.query(
      `INSERT INTO app_settings(key,value) VALUES('sidebar-order',$1::jsonb)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
      [JSON.stringify(order)]
    )
    res.json({ order })
  })

  app.get('/api/goals', async (_req, res) =>
    res.json(
      (await db.query(`SELECT value FROM app_settings WHERE key='nutrition-goals'`)).rows[0]
        ?.value ?? {}
    )
  )
  app.put('/api/goals', async (req, res) => {
    const values: Record<string, number> = {}
    for (const n of nutrients) {
      const value = req.body?.[n]
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000)
        throw new Error('Цели должны быть неотрицательными числами.')
      values[n] = value
    }
    await db.query(
      `INSERT INTO app_settings(key,value) VALUES('nutrition-goals',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
      [JSON.stringify(values)]
    )
    res.json(values)
  })
  app.get('/api/import/preview', async (_req, res) => {
    const data = await bundle()
    const previous = (
      await db.query('SELECT report FROM import_batches WHERE hash=$1', [data.sha256])
    ).rows[0]
    res.json({
      filename: data.filename,
      hash: data.sha256,
      counts: {
        operations: data.operations.length,
        ...Object.fromEntries(
          Object.entries(data.records).map(([key, rows]) => [key, (rows as unknown[]).length])
        )
      },
      issues: data.issues,
      summary: data.summary,
      budgetTemplate: data.budgetTemplate,
      imported: !!previous,
      report: previous?.report
    })
  })
  app.post('/api/import/apply', async (_req, res) => {
    const data = await bundle()
    const c = await db.connect()
    let report: Record<string, unknown> = {}
    try {
      await c.query('BEGIN')
      // Уникальный hash и транзакция защищают от повторного/одновременного импорта.
      const claim = await c.query(
        `INSERT INTO import_batches(hash,filename,report) VALUES($1,$2,'{}') ON CONFLICT DO NOTHING RETURNING hash`,
        [data.sha256, data.filename]
      )
      if (!claim.rows.length) {
        await c.query('ROLLBACK')
        res.json({ alreadyImported: true })
        return
      }
      let added = 0,
        matched = 0
      const counts: Record<string, number> = {}
      for (const raw of data.operations) {
        const b = operationInput(raw)
        const source = `excel-v1:${raw.source}`
        if ((await c.query('SELECT 1 FROM imported_rows WHERE source=$1', [source])).rows.length)
          continue
        const existing = await c.query(
          `SELECT id FROM expenses WHERE title=$1 AND amount=$2 AND category=$3 AND type=$4 AND operation_date=$5::date AND subcategory=$6 AND counterparty=$7 AND note=$8 AND id NOT IN(SELECT record_id FROM imported_rows) LIMIT 1`,
          [b.title, b.amount, b.category, b.type, b.date, b.subcategory, b.counterparty, b.note]
        )
        const id = existing.rows[0]?.id ?? randomUUID()
        if (existing.rows.length) matched++
        else {
          await c.query(
            `INSERT INTO expenses(id,title,amount,category,type,operation_date,subcategory,counterparty,note) VALUES($1,$2,$3,$4,$5,$6::date,$7,$8,$9)`,
            [
              id,
              b.title,
              b.amount.toFixed(2),
              b.category,
              b.type,
              b.date,
              b.subcategory,
              b.counterparty,
              b.note
            ]
          )
          added++
        }
        await c.query('INSERT INTO imported_rows(source,record_id) VALUES($1,$2)', [source, id])
      }
      for (const [kind, rows] of Object.entries(data.records)) {
        if (!isKind(kind)) continue
        counts[kind] = 0
        for (const raw of rows as Record<string, unknown>[]) {
          const source = `excel-v1:${raw.source}`
          if ((await c.query('SELECT 1 FROM imported_rows WHERE source=$1', [source])).rows.length)
            continue
          const entry = validateEntry(kind, raw)
          const id = randomUUID()
          await c.query('INSERT INTO journal_entries(id,kind,data) VALUES($1,$2,$3::jsonb)', [
            id,
            kind,
            JSON.stringify(entry)
          ])
          await c.query('INSERT INTO imported_rows(source,record_id) VALUES($1,$2)', [source, id])
          counts[kind]++
        }
      }
      await c.query(
        `INSERT INTO app_settings(key,value) VALUES('nutrition-goals',$1::jsonb) ON CONFLICT DO NOTHING`,
        [JSON.stringify(data.goals)]
      )
      report = {
        operationsAdded: added,
        operationsMatched: matched,
        records: counts,
        issues: data.issues
      }
      await c.query('UPDATE import_batches SET report=$1::jsonb WHERE hash=$2', [
        JSON.stringify(report),
        data.sha256
      ])
      await c.query('COMMIT')
    } catch (e) {
      await c.query('ROLLBACK')
      throw e
    } finally {
      c.release()
    }
    res.json(report)
  })
  app.post('/api/budget-template', async (req, res) => {
    const month = req.body?.month
    if (!monthValid(month)) throw new Error('Выбери месяц.')
    const data = await bundle()
    const c = await db.connect()
    let added = 0
    try {
      await c.query('BEGIN')
      for (const b of data.budgetTemplate) {
        const r = await c.query(
          `INSERT INTO budgets(id,category,amount,month) VALUES($1,$2,$3,$4::date) ON CONFLICT(month,category) DO NOTHING RETURNING id`,
          [randomUUID(), b.category, b.amount, `${month}-01`]
        )
        added += r.rows.length
      }
      await c.query('COMMIT')
    } catch (e) {
      await c.query('ROLLBACK')
      throw e
    } finally {
      c.release()
    }
    res.json({ added })
  })
  app.get('/api/export', async (_req, res) => {
    const client = await db.connect()
    const result: Record<string, unknown> = { version: 2, exportedAt: new Date().toISOString() }
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      for (const table of [
        'expenses',
        'operation_categories',
        'operation_templates',
        'budgets',
        'journal_entries',
        'tasks',
        'task_occurrences',
        'personal_goals','monthly_goals',
        'app_settings',
        'import_batches',
        'imported_rows'
      ])
        result[table] = (await client.query(`SELECT * FROM ${table}`)).rows
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
    res.attachment(`trellis-backup-${new Date().toISOString().slice(0, 10)}.json`).json(result)
  })
  app.use('/api', (_req, res) =>
    res.status(404).json({ error: 'Такого API нет. Перезапусти приложение.' })
  )
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const known = !error.code && !error.syscall
    console.error(error.message)
    res
      .status(error.type === 'entity.parse.failed' ? 400 : known ? 400 : 503)
      .json({
        error: known
          ? error.message
          : 'Не удалось выполнить запрос. Проверь, что PostgreSQL запущен, и повтори.'
      })
  }
  app.use(errors)
  return app
}
