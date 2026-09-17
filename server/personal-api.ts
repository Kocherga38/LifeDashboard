import express from 'express'
import { randomUUID } from 'node:crypto'
import type { DB } from './database.js'
import { validDate } from '../shared/journals.js'

const idValid = (s: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s)
const textValid = (s: unknown, max = 100): s is string =>
  typeof s === 'string' && !!s.trim() && s.length <= max

export function createPersonalApi(db: DB) {
  const app = express()
  app.use(express.json({ limit: '2mb' }))

  app.get('/api/note-folders', async (_req, res) => {
    res.json((await db.query(`SELECT id,name,parent_id AS "parentId" FROM note_folders ORDER BY name,id`)).rows)
  })
  app.post('/api/note-folders', async (req, res) => {
    const name = req.body?.name, parentId = req.body?.parentId ?? null
    if (!textValid(name, 120) || (parentId !== null && !idValid(String(parentId))))
      throw new Error('Проверь название и родительскую папку.')
    const row = (await db.query(
      `INSERT INTO note_folders(id,name,parent_id) VALUES($1,$2,$3) RETURNING id,name,parent_id AS "parentId"`,
      [randomUUID(), name.trim(), parentId]
    )).rows[0]
    res.status(201).json(row)
  })
  app.put('/api/note-folders/:id', async (req, res) => {
    const id = String(req.params.id), name = req.body?.name
    if (!idValid(id) || !textValid(name, 120)) throw new Error('Проверь папку и название.')
    const r = await db.query(
      `UPDATE note_folders SET name=$1 WHERE id=$2 RETURNING id,name,parent_id AS "parentId"`,
      [name.trim(), id]
    )
    if (!r.rows.length) { res.status(404).json({ error: 'Папка не найдена.' }); return }
    res.json(r.rows[0])
  })
  app.delete('/api/note-folders/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!idValid(id)) throw new Error('Некорректный ID.')
    await db.query('DELETE FROM note_folders WHERE id=$1', [id])
    res.status(204).end()
  })

  app.get('/api/notes', async (_req, res) => {
    res.json((await db.query(
      `SELECT id,folder_id AS "folderId",title,content,updated_at AS "updatedAt" FROM notes ORDER BY updated_at DESC,id DESC`
    )).rows)
  })
  app.post('/api/notes', async (req, res) => {
    const title = req.body?.title, content = req.body?.content ?? '', folderId = req.body?.folderId ?? null
    if (!textValid(title, 200) || typeof content !== 'string' || content.length > 500000 || (folderId !== null && !idValid(String(folderId))))
      throw new Error('Проверь заметку.')
    const row = (await db.query(
      `INSERT INTO notes(id,folder_id,title,content) VALUES($1,$2,$3,$4) RETURNING id,folder_id AS "folderId",title,content,updated_at AS "updatedAt"`,
      [randomUUID(), folderId, title.trim(), content]
    )).rows[0]
    res.status(201).json(row)
  })
  app.put('/api/notes/:id', async (req, res) => {
    const id = String(req.params.id), title = req.body?.title, content = req.body?.content ?? '', folderId = req.body?.folderId ?? null
    if (!idValid(id) || !textValid(title, 200) || typeof content !== 'string' || content.length > 500000 || (folderId !== null && !idValid(String(folderId))))
      throw new Error('Проверь заметку.')
    const r = await db.query(
      `UPDATE notes SET folder_id=$1,title=$2,content=$3,updated_at=NOW() WHERE id=$4 RETURNING id,folder_id AS "folderId",title,content,updated_at AS "updatedAt"`,
      [folderId, title.trim(), content, id]
    )
    if (!r.rows.length) { res.status(404).json({ error: 'Заметка не найдена.' }); return }
    res.json(r.rows[0])
  })
  app.delete('/api/notes/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!idValid(id)) throw new Error('Некорректный ID.')
    await db.query('DELETE FROM notes WHERE id=$1', [id])
    res.status(204).end()
  })

  app.get('/api/diary', async (_req, res) =>
    res.json((await db.query(
      `SELECT id,to_char(entry_date,'YYYY-MM-DD') AS date,title,content,created_at AS "createdAt" FROM diary_entries ORDER BY entry_date DESC,created_at DESC`
    )).rows)
  )
  app.post('/api/diary', async (req, res) => {
    const { date, title = '', content } = req.body ?? {}
    if (!validDate(date) || typeof title !== 'string' || title.length > 200 || !textValid(content, 500000))
      throw new Error('Проверь дату и текст записи.')
    const row = (await db.query(
      `INSERT INTO diary_entries(id,entry_date,title,content) VALUES($1,$2::date,$3,$4) RETURNING id,to_char(entry_date,'YYYY-MM-DD') AS date,title,content,created_at AS "createdAt"`,
      [randomUUID(), date, title.trim(), content.trim()]
    )).rows[0]
    res.status(201).json(row)
  })
  app.put('/api/diary/:id', async (req, res) => {
    const id = String(req.params.id), { date, title = '', content } = req.body ?? {}
    if (!idValid(id) || !validDate(date) || typeof title !== 'string' || title.length > 200 || !textValid(content, 500000))
      throw new Error('Проверь запись.')
    const r = await db.query(
      `UPDATE diary_entries SET entry_date=$1::date,title=$2,content=$3,updated_at=NOW() WHERE id=$4 RETURNING id,to_char(entry_date,'YYYY-MM-DD') AS date,title,content,created_at AS "createdAt"`,
      [date, title.trim(), content.trim(), id]
    )
    if (!r.rows.length) { res.status(404).json({ error: 'Запись не найдена.' }); return }
    res.json(r.rows[0])
  })
  app.delete('/api/diary/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!idValid(id)) throw new Error('Некорректный ID.')
    await db.query('DELETE FROM diary_entries WHERE id=$1', [id])
    res.status(204).end()
  })

  const flashFields = `id,deck,front,back,to_char(due_date,'YYYY-MM-DD') AS "dueDate",interval_days AS "intervalDays",repetitions,lapses`
  const flashSerial = (r: Record<string, any>) => ({
    ...r,
    intervalDays: Number(r.intervalDays),
    repetitions: Number(r.repetitions),
    lapses: Number(r.lapses)
  })
  app.get('/api/flashcards', async (_req, res) =>
    res.json((await db.query(`SELECT ${flashFields} FROM flashcards ORDER BY due_date,created_at,id`)).rows.map(flashSerial))
  )
  app.post('/api/flashcards', async (req, res) => {
    const { front, back, deck = 'Основная' } = req.body ?? {}
    if (!textValid(front, 20000) || !textValid(back, 20000) || !textValid(deck, 100))
      throw new Error('Заполни обе стороны карточки.')
    const row = (await db.query(
      `INSERT INTO flashcards(id,deck,front,back) VALUES($1,$2,$3,$4) RETURNING ${flashFields}`,
      [randomUUID(), deck.trim(), front.trim(), back.trim()]
    )).rows[0]
    res.status(201).json(flashSerial(row))
  })
  app.put('/api/flashcards/:id', async (req, res) => {
    const id = String(req.params.id), { front, back, deck = 'Основная' } = req.body ?? {}
    if (!idValid(id) || !textValid(front, 20000) || !textValid(back, 20000) || !textValid(deck, 100))
      throw new Error('Проверь карточку.')
    const r = await db.query(
      `UPDATE flashcards SET deck=$1,front=$2,back=$3,updated_at=NOW() WHERE id=$4 RETURNING ${flashFields}`,
      [deck.trim(), front.trim(), back.trim(), id]
    )
    if (!r.rows.length) { res.status(404).json({ error: 'Карточка не найдена.' }); return }
    res.json(flashSerial(r.rows[0]))
  })
  app.post('/api/flashcards/:id/review', async (req, res) => {
    const id = String(req.params.id), rating = String(req.body?.rating ?? '')
    if (!idValid(id) || !['again', 'hard', 'good', 'easy'].includes(rating)) throw new Error('Некорректная оценка.')
    const card = (await db.query(`SELECT interval_days,ease_factor,repetitions,lapses FROM flashcards WHERE id=$1`, [id])).rows[0]
    if (!card) { res.status(404).json({ error: 'Карточка не найдена.' }); return }
    let interval = Number(card.interval_days), ease = Number(card.ease_factor), reps = Number(card.repetitions), lapses = Number(card.lapses)
    if (rating === 'again') { interval = 1; reps = 0; lapses++; ease = Math.max(1.3, ease - 0.2) }
    else if (rating === 'hard') { interval = Math.max(1, Math.round(Math.max(1, interval) * 1.2)); reps++; ease = Math.max(1.3, ease - 0.15) }
    else if (rating === 'good') { interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(1, Math.round(Math.max(1, interval) * ease)); reps++ }
    else { interval = reps === 0 ? 4 : Math.max(2, Math.round(Math.max(1, interval) * ease * 1.3)); reps++; ease = Math.min(4, ease + 0.15) }
    const row = (await db.query(
      `UPDATE flashcards SET interval_days=$1,ease_factor=$2,repetitions=$3,lapses=$4,due_date=CURRENT_DATE+$1::int,last_reviewed_at=NOW(),updated_at=NOW() WHERE id=$5 RETURNING ${flashFields}`,
      [interval, ease, reps, lapses, id]
    )).rows[0]
    res.json(flashSerial(row))
  })
  app.delete('/api/flashcards/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!idValid(id)) throw new Error('Некорректный ID.')
    await db.query('DELETE FROM flashcards WHERE id=$1', [id])
    res.status(204).end()
  })

  app.get('/api/habits', async (_req, res) =>
    res.json((await db.query(`SELECT id,name,created_at AS "createdAt" FROM habits ORDER BY created_at,name`)).rows)
  )
  app.post('/api/habits', async (req, res) => {
    const name = req.body?.name
    if (!textValid(name, 120)) throw new Error('Введи название трекера.')
    const row = (await db.query(
      `INSERT INTO habits(id,name) VALUES($1,$2) RETURNING id,name,created_at AS "createdAt"`,
      [randomUUID(), name.trim()]
    )).rows[0]
    res.status(201).json(row)
  })
  app.put('/api/habits/:id', async (req, res) => {
    const id = String(req.params.id), name = req.body?.name
    if (!idValid(id) || !textValid(name, 120)) throw new Error('Проверь трекер.')
    const r = await db.query(`UPDATE habits SET name=$1 WHERE id=$2 RETURNING id,name,created_at AS "createdAt"`, [name.trim(), id])
    if (!r.rows.length) { res.status(404).json({ error: 'Трекер не найден.' }); return }
    res.json(r.rows[0])
  })
  app.delete('/api/habits/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!idValid(id)) throw new Error('Некорректный ID.')
    await db.query('DELETE FROM habits WHERE id=$1', [id])
    res.status(204).end()
  })
  app.get('/api/habit-marks', async (req, res) => {
    const { from, to } = req.query
    if (!validDate(from) || !validDate(to) || String(from) > String(to)) throw new Error('Некорректный период.')
    res.json((await db.query(
      `SELECT habit_id AS "habitId",to_char(mark_date,'YYYY-MM-DD') AS date FROM habit_marks WHERE mark_date BETWEEN $1::date AND $2::date ORDER BY mark_date`,
      [from, to]
    )).rows)
  })
  app.post('/api/habits/:id/toggle', async (req, res) => {
    const id = String(req.params.id), date = req.body?.date
    if (!idValid(id) || !validDate(date)) throw new Error('Проверь дату.')
    const deleted = await db.query(`DELETE FROM habit_marks WHERE habit_id=$1 AND mark_date=$2::date RETURNING habit_id`, [id, date])
    if (deleted.rows.length) { res.json({ habitId: id, date, marked: false }); return }
    await db.query(`INSERT INTO habit_marks(habit_id,mark_date) VALUES($1,$2::date)`, [id, date])
    res.json({ habitId: id, date, marked: true })
  })

  app.get('/api/export', async (_req, res) => {
    const client = await db.connect()
    const result: Record<string, unknown> = { version: 2, exportedAt: new Date().toISOString() }
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      for (const table of [
        'expenses','budgets','journal_entries','tasks','task_occurrences','note_folders','notes',
        'diary_entries','flashcards','habits','habit_marks','app_settings','import_batches','imported_rows'
      ]) result[table] = (await client.query(`SELECT * FROM ${table}`)).rows
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally { client.release() }
    res.attachment(`life-backup-${new Date().toISOString().slice(0,10)}.json`).json(result)
  })

  return app
}
