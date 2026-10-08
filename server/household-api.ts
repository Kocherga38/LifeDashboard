import express from 'express'
import { randomUUID } from 'node:crypto'
import type { DB, Queryable } from './database.js'
import { validDate } from '../shared/journals.js'
import { validateDiaryImages } from '../shared/diary.js'

const id = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
const text = (value: unknown, max: number, required = false): value is string => typeof value === 'string' && value.length <= max && (!required || !!value.trim())
const interval = (value: unknown) => value == null ? null : Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 3650 ? Number(value) : (() => { throw new Error('Интервал должен быть от 1 до 3650 дней.') })()
const currentDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date())
function recordedDate(value: unknown) { if (!validDate(value) || value > currentDate()) throw new Error('Выбери дату не позднее сегодняшней.'); return value }
function itemInput(raw: Record<string, unknown> = {}, supply = false) {
  const { name, details = '', photo = '', category = 'Для дома', runningLow = false } = raw
  if (!text(name, supply ? 100 : 120, true) || !text(details, 250)) throw new Error('Проверь название и описание.')
  if (supply && (!text(category, 100, true) || typeof runningLow !== 'boolean')) throw new Error('Проверь категорию и состояние запаса.')
  if (!supply) {
    if (typeof photo !== 'string') throw new Error('Некорректное фото вещи.')
    if (photo) validateDiaryImages([{ id: 'photo', name: 'Фото вещи', dataUrl: photo }])
  }
  return { name: name.trim(), details: details.trim(), photo, category: String(category).trim(), runningLow, intervalDays: interval(raw.intervalDays) }
}
async function transaction<T>(db: DB, action: (db: Queryable) => Promise<T>) {
  const client = await db.connect()
  try { await client.query('BEGIN'); const value = await action(client); await client.query('COMMIT'); return value }
  catch (e) { await client.query('ROLLBACK'); throw e }
  finally { client.release() }
}
const laundryFields = `id,name,details,interval_days AS "intervalDays",photo`
const supplyFields = `id,name,details,category,interval_days AS "intervalDays",running_low AS "runningLow"`
const washFields = `id,item_id AS "itemId",to_char(washed_on,'YYYY-MM-DD') AS date,note`
const purchaseFields = `p.id,p.item_id AS "itemId",to_char(COALESCE(e.operation_date,p.purchased_on),'YYYY-MM-DD') AS date,COALESCE(e.amount,p.amount) AS amount,p.quantity,p.note,p.operation_id AS "operationId",(p.owns_operation AND p.operation_id IS NOT NULL) AS "ownsOperation",COALESCE(e.category,i.category) AS category`
const purchaseQuery = `SELECT ${purchaseFields} FROM supply_purchases p JOIN supply_items i ON i.id=p.item_id LEFT JOIN expenses e ON e.id=p.operation_id`
const serialPurchase = (r: Record<string, any>) => ({ ...r, amount: Number(r.amount) })
export function createHouseholdApi(db: DB) {
  const app = express.Router()
  for (const supply of [false, true]) {
    const path = supply ? '/api/supplies/items' : '/api/laundry/items'
    const table = supply ? 'supply_items' : 'laundry_items'
    const fields = supply ? supplyFields : laundryFields
    app.get(path, async (_req, res) => { res.json((await db.query(`SELECT ${fields} FROM ${table} ORDER BY lower(name),id`)).rows) })
    app.post(path, async (req, res) => {
      const x = itemInput(req.body, supply)
      const result = supply
        ? await db.query(`INSERT INTO supply_items(id,name,details,category,interval_days,running_low) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${fields}`, [randomUUID(),x.name,x.details,x.category,x.intervalDays,x.runningLow])
        : await db.query(`INSERT INTO laundry_items(id,name,details,interval_days,photo) VALUES($1,$2,$3,$4,$5) RETURNING ${fields}`, [randomUUID(),x.name,x.details,x.intervalDays,x.photo])
      res.status(201).json(result.rows[0])
    })
    app.put(`${path}/:id`, async (req, res) => {
      if (!id(req.params.id)) throw new Error('Некорректный ID.')
      const x = itemInput(req.body, supply)
      const result = supply
        ? await db.query(`UPDATE supply_items SET name=$2,details=$3,category=$4,interval_days=$5,running_low=$6 WHERE id=$1 RETURNING ${fields}`, [req.params.id,x.name,x.details,x.category,x.intervalDays,x.runningLow])
        : await db.query(`UPDATE laundry_items SET name=$2,details=$3,interval_days=$4,photo=$5 WHERE id=$1 RETURNING ${fields}`, [req.params.id,x.name,x.details,x.intervalDays,x.photo])
      if (!result.rows.length) { res.status(404).json({ error: 'Запись не найдена.' }); return }
      res.json(result.rows[0])
    })
    app.delete(`${path}/:id`, async (req, res) => {
      if (!id(req.params.id)) throw new Error('Некорректный ID.')
      const r = await db.query(`DELETE FROM ${table} WHERE id=$1 RETURNING id`, [req.params.id])
      if (!r.rows.length) { res.status(404).json({ error: 'Запись не найдена.' }); return }
      // Expenses survive deleting a tracked product; history survives cascades.
      res.status(204).end()
    })
  }
  app.get('/api/laundry/washes', async (_req, res) => { res.json((await db.query(`SELECT ${washFields} FROM laundry_washes ORDER BY washed_on DESC,created_at DESC,id DESC`)).rows) })
  app.post('/api/laundry/washes', async (req, res) => {
    const { itemIds, itemId, note = '' } = req.body ?? {}
    const ids = itemIds ?? [itemId]
    const date = recordedDate(req.body?.date)
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every(id) || new Set(ids).size !== ids.length || !text(note, 500)) throw new Error('Выбери вещи и короткий комментарий.')
    const rows = await transaction(db, async (client) => {
      const found = await client.query('SELECT id FROM laundry_items WHERE id=ANY($1::uuid[]) FOR UPDATE', [ids])
      if (found.rows.length !== ids.length) throw new Error('Одна из вещей больше не существует.')
      const result = []
      for (const item of ids) {
        // One mark per item/date, also for old schemas with duplicate rows.
        if ((await client.query('SELECT id FROM laundry_washes WHERE item_id=$1 AND washed_on=$2::date', [item,date])).rows.length) continue
        result.push((await client.query(`INSERT INTO laundry_washes(id,item_id,washed_on,note) VALUES($1,$2,$3,$4) RETURNING ${washFields}`, [randomUUID(),item,date,note.trim()])).rows[0])
      }
      return result
    })
    res.status(201).json(rows)
  })
  app.put('/api/laundry/washes/:id', async (req, res) => {
    const date = recordedDate(req.body?.date), note = req.body?.note ?? ''
    if (!id(req.params.id) || !text(note,500)) throw new Error('Проверь запись стирки.')
    const result = await transaction(db, async (client) => {
      const old = (await client.query('SELECT item_id FROM laundry_washes WHERE id=$1', [req.params.id])).rows[0]
      if (!old) return null
      await client.query('SELECT id FROM laundry_items WHERE id=$1 FOR UPDATE', [old.item_id])
      if ((await client.query('SELECT id FROM laundry_washes WHERE item_id=$1 AND washed_on=$2::date AND id<>$3', [old.item_id,date,req.params.id])).rows.length) throw new Error('Для этой вещи уже отмечена стирка в выбранный день.')
      return (await client.query(`UPDATE laundry_washes SET washed_on=$2,note=$3 WHERE id=$1 RETURNING ${washFields}`, [req.params.id,date,note.trim()])).rows[0]
    })
    if (!result) { res.status(404).json({ error: 'Стирка не найдена.' }); return }
    res.json(result)
  })
  app.delete('/api/laundry/washes/:id', async (req, res) => {
    if (!id(req.params.id)) throw new Error('Некорректный ID.')
    const r = await db.query('DELETE FROM laundry_washes WHERE id=$1 RETURNING id', [req.params.id])
    if (!r.rows.length) { res.status(404).json({ error: 'Стирка не найдена.' }); return }
    res.status(204).end()
  })
  app.get('/api/supplies/purchases', async (_req, res) => { res.json((await db.query(`${purchaseQuery} ORDER BY date DESC,p.created_at DESC,p.id DESC`)).rows.map(serialPurchase)) })
  async function savePurchase(body: Record<string, any>, purchaseId?: string) {
    const { itemId, quantity = '', note = '', finance = 'none', operationId = null } = body
    if (!id(itemId) || !text(quantity,120) || !text(note,500) || !['none','create','link'].includes(finance) || (finance === 'link' && !id(operationId))) throw new Error('Проверь покупку и связь с расходом.')
    return transaction(db, async (client) => {
      const item = (await client.query('SELECT * FROM supply_items WHERE id=$1 FOR UPDATE', [itemId])).rows[0]
      if (!item) throw new Error('Запас не найден.')
      const old = purchaseId ? (await client.query('SELECT * FROM supply_purchases WHERE id=$1 FOR UPDATE', [purchaseId])).rows[0] : null
      if (purchaseId && !old) throw new Error('Покупка не найдена.')
      // A linked purchase cannot silently detach or create a duplicate expense.
      if (old?.operation_id && (finance === 'none' || finance === 'create' && !old.owns_operation || finance === 'link' && operationId !== old.operation_id)) throw new Error('У покупки уже есть расход. Измени его или сначала удали запись покупки, сохранив расход.')
      let date: string, amount: number, expenseId: string | null = null, owns = false
      if (finance === 'link') {
        const expense = (await client.query(`SELECT * FROM expenses WHERE id=$1 AND type='expense' FOR UPDATE`, [operationId])).rows[0]
        if (!expense) throw new Error('Расход не найден.')
        if ((await client.query('SELECT id FROM supply_purchases WHERE operation_id=$1 AND ($2::uuid IS NULL OR id<>$2)', [operationId,purchaseId ?? null])).rows.length) throw new Error('Этот расход уже связан с другой покупкой.')
        date = recordedDate(typeof expense.operation_date === 'string' ? expense.operation_date.slice(0,10) : expense.operation_date.toISOString().slice(0,10))
        amount = Number(expense.amount); expenseId = operationId; owns = !!old?.owns_operation && old.operation_id === expenseId
      } else {
        date = recordedDate(body.date); amount = body.amount
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0.01 || amount > 999999999.99 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.0001) throw new Error('Введи положительную стоимость с точностью до копеек.')
        if (finance === 'create') {
          expenseId = old?.owns_operation && old.operation_id ? old.operation_id : randomUUID(); owns = true
          if (old?.owns_operation && old.operation_id) await client.query(`UPDATE expenses SET title=$2,amount=$3,category=$4,operation_date=$5,note=$6 WHERE id=$1`, [expenseId,item.name,amount,item.category,date,note])
          else await client.query(`INSERT INTO expenses(id,title,amount,category,type,operation_date,note) VALUES($1,$2,$3,$4,'expense',$5,$6)`, [expenseId,item.name,amount,item.category,date,note])
        }
      }
      const newId = purchaseId ?? randomUUID()
      if (old) await client.query(`UPDATE supply_purchases SET item_id=$2,purchased_on=$3,amount=$4,quantity=$5,note=$6,operation_id=$7,owns_operation=$8 WHERE id=$1`, [newId,itemId,date,amount,quantity,note,expenseId,owns])
      else await client.query(`INSERT INTO supply_purchases(id,item_id,purchased_on,amount,quantity,note,operation_id,owns_operation) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [newId,itemId,date,amount,quantity,note,expenseId,owns])
      await client.query('UPDATE supply_items SET running_low=FALSE WHERE id=$1 AND running_low=TRUE', [itemId])
      return serialPurchase((await client.query(`${purchaseQuery} WHERE p.id=$1`, [newId])).rows[0])
    })
  }
  app.post('/api/supplies/purchases', async (req, res) => { res.status(201).json(await savePurchase(req.body ?? {})) })
  app.put('/api/supplies/purchases/:id', async (req, res) => {
    if (!id(req.params.id)) throw new Error('Некорректный ID.')
    res.json(await savePurchase(req.body ?? {}, req.params.id))
  })
  app.delete('/api/supplies/purchases/:id', async (req, res) => {
    if (!id(req.params.id)) throw new Error('Некорректный ID.')
    const removed = await transaction(db, async (client) => {
      const row = (await client.query('DELETE FROM supply_purchases WHERE id=$1 RETURNING *', [req.params.id])).rows[0]
      if (req.query.deleteExpense === 'true' && row?.operation_id) {
        if (!row.owns_operation) throw new Error('Этот расход создан отдельно. Удали его в разделе «Операции».')
        await client.query('DELETE FROM expenses WHERE id=$1', [row.operation_id])
      }
      return row
    })
    if (!removed) { res.status(404).json({ error: 'Покупка не найдена.' }); return }
    res.status(204).end()
  })
  return app
}
