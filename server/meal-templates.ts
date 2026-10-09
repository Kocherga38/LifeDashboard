import express from 'express'
import { randomUUID } from 'node:crypto'
import type { DB } from './database.js'
import { nutrients, validDate, validateEntry } from '../shared/journals.js'

type Item = { name: string; grams: number }
function parseItems(raw: unknown): Item[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 40) throw new Error('Добавь от 1 до 40 продуктов.')
  return raw.map((v: unknown) => {
    const item = v as Partial<Item> | null
    if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200 ||
        typeof item.grams !== 'number' || !Number.isFinite(item.grams) || item.grams <= 0 || item.grams > 100000)
      throw new Error('Проверь продукты и граммовки.')
    return { name: item.name.trim(), grams: item.grams }
  })
}
function parseTemplate(raw: any) {
  if (!raw || typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 160)
    throw new Error('Укажи название шаблона.')
  return { title: raw.title.trim(), items: parseItems(raw.items) }
}
const uuid = (value: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)

export function createMealTemplatesApi(db: DB) {
  const app = express.Router()
  app.get('/api/meal-templates', async (_req, res) => {
    const rows = await db.query('SELECT id,title,items FROM meal_templates ORDER BY title,id')
    res.json(rows.rows)
  })
  app.post('/api/meal-templates', async (req, res) => {
    const v = parseTemplate(req.body)
    const id = randomUUID()
    await db.query('INSERT INTO meal_templates(id,title,items) VALUES($1,$2,$3::jsonb)', [id,v.title,JSON.stringify(v.items)])
    res.status(201).json({ id, ...v })
  })
  app.put('/api/meal-templates/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!uuid(id)) throw new Error('Некорректный ID.')
    const v = parseTemplate(req.body)
    const result = await db.query('UPDATE meal_templates SET title=$2,items=$3::jsonb WHERE id=$1 RETURNING id', [id,v.title,JSON.stringify(v.items)])
    if (!result.rows.length) { res.status(404).json({ error: 'Шаблон не найден.' }); return }
    res.json({ id,...v })
  })
  app.delete('/api/meal-templates/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!uuid(id)) throw new Error('Некорректный ID.')
    await db.query('DELETE FROM meal_templates WHERE id=$1',[id])
    res.status(204).end()
  })
  app.post('/api/meal-templates/:id/use', async (req, res) => {
    const id = String(req.params.id)
    const { date, meal, time = '', note = '', items } = req.body ?? {}
    if (!uuid(id) || !validDate(date) || !['Завтрак','Обед','Ужин','Перекус'].includes(meal) ||
        (time && (typeof time !== 'string' || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(time))) ||
        typeof note !== 'string' || note.length > 5000)
      throw new Error('Проверь дату и приём пищи.')
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const template = (await client.query('SELECT items FROM meal_templates WHERE id=$1',[id])).rows[0]
      if (!template) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Шаблон не найден.' }); return }
      const wanted = items === undefined ? parseItems(template.items) : parseItems(items)
      const names = [...new Set(wanted.map(x=>x.name))]
      const products = (await client.query("SELECT data FROM journal_entries WHERE kind='products' AND data->>'name'=ANY($1::text[]) ORDER BY created_at DESC", [names])).rows
      const byName = new Map<string, Record<string, unknown>>()
      for (const row of products) if (!byName.has(String(row.data.name))) byName.set(String(row.data.name),row.data)
      const missing = names.filter(n=>!byName.has(n))
      if (missing.length) { await client.query('ROLLBACK'); res.status(409).json({error: 'Нет в справочнике: '+missing.join(', ')});return }
      const saved = []
      for (const item of wanted) {
        const product = byName.get(item.name)!
        const data = validateEntry('meals',{
          date,meal,time,note,name:item.name,grams:item.grams,
          ...Object.fromEntries(nutrients.map(n=>[n,Number(product[n])]))
        })
        const entryId = randomUUID()
        await client.query("INSERT INTO journal_entries(id,kind,data) VALUES($1,'meals',$2::jsonb)",[entryId,JSON.stringify(data)])
        saved.push({id:entryId,...data})
      }
      await client.query('COMMIT')
      res.status(201).json(saved)
    } catch(e) { await client.query('ROLLBACK'); throw e }
    finally { client.release() }
  })
  return app
}
