import express from 'express'
import type { Queryable, DB } from './database.js'
import { validDate } from '../shared/journals.js'

// One registry for both backup routes and history coverage.
export const dataTables = [
  'expenses', 'operation_categories', 'operation_templates', 'budgets', 'journal_entries',
  'sleep_entries', 'tasks', 'task_occurrences', 'note_folders', 'notes', 'diary_entries',
  'laundry_items', 'laundry_washes', 'supply_items', 'supply_purchases',
  'flashcards', 'habits', 'habit_marks', 'personal_goals', 'monthly_goals', 'app_settings',
  'calendar_events', 'planned_shifts', 'meal_notes', 'speaking_sessions', 'weekly_reflections'
] as const

export async function installActivityLog(client: Queryable) {
  await client.query(`CREATE TABLE IF NOT EXISTS activity_log (
    id BIGSERIAL PRIMARY KEY,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    transaction_id BIGINT NOT NULL DEFAULT txid_current(),
    table_name TEXT NOT NULL,
    record_key JSONB NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('snapshot','create','update','delete','navigate','export')),
    before_data JSONB,
    after_data JSONB,
    source TEXT NOT NULL DEFAULT 'database' CHECK(source IN ('database','app'))
  )`)
  await client.query(`CREATE INDEX IF NOT EXISTS activity_log_record_idx ON activity_log(table_name,record_key,id)`)
  await client.query(`CREATE TABLE IF NOT EXISTS activity_log_baselines (
    table_name TEXT PRIMARY KEY, captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  )`)
  await client.query(`CREATE OR REPLACE FUNCTION trellis_record_change() RETURNS trigger AS $$
    DECLARE previous JSONB; following JSONB; row_data JSONB; row_key JSONB := '{}'::jsonb;
    BEGIN
      IF TG_OP <> 'INSERT' THEN previous := to_jsonb(OLD); END IF;
      IF TG_OP <> 'DELETE' THEN following := to_jsonb(NEW); END IF;
      IF TG_OP = 'UPDATE' AND previous = following THEN RETURN NEW; END IF;
      row_data := COALESCE(following,previous);
      FOR i IN 0..TG_NARGS-1 LOOP
        row_key := row_key || jsonb_build_object(TG_ARGV[i],row_data->TG_ARGV[i]);
      END LOOP;
      INSERT INTO activity_log(table_name,record_key,action,before_data,after_data)
        VALUES(TG_TABLE_NAME,row_key,CASE TG_OP WHEN 'INSERT' THEN 'create'
          WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,previous,following);
      RETURN COALESCE(NEW,OLD);
    END;
  $$ LANGUAGE plpgsql`)
  // Independent rows, without foreign keys: cascading deletes cannot erase history.
  await client.query(`CREATE OR REPLACE FUNCTION trellis_protect_history() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'История изменений доступна только для добавления'; END;
  $$ LANGUAGE plpgsql`)
  await client.query(`DROP TRIGGER IF EXISTS trellis_history_immutable ON activity_log`)
  await client.query(`CREATE TRIGGER trellis_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
    ON activity_log FOR EACH STATEMENT EXECUTE FUNCTION trellis_protect_history()`)

  for (const table of dataTables) {
    const keys = (await client.query(`
      SELECT a.attname AS name FROM pg_index i
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
      WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY a.attnum`, [table]
    )).rows.map((row) => String(row.name))
    if (!keys.length) throw new Error(`Нет первичного ключа для журнала: ${table}`)
    const baseline = await client.query(`INSERT INTO activity_log_baselines(table_name)
      VALUES($1) ON CONFLICT DO NOTHING RETURNING table_name`, [table])
    const keyExpression = keys.map((key) => `'${key}',to_jsonb(t)->'${key}'`).join(',')
    if (baseline.rows.length) {
      await client.query(`INSERT INTO activity_log(table_name,record_key,action,after_data)
        SELECT $1,jsonb_build_object(${keyExpression}),'snapshot',to_jsonb(t)
        FROM ${table} t ORDER BY ${keys.join(',')}`, [table])
    }
    await client.query(`DROP TRIGGER IF EXISTS trellis_activity ON ${table}`)
    await client.query(`CREATE TRIGGER trellis_activity AFTER INSERT OR UPDATE OR DELETE
      ON ${table} FOR EACH ROW EXECUTE FUNCTION trellis_record_change(${keys.map((key) => `'${key}'`).join(',')})`)
  }
}

export async function exportData(db: DB) {
  const client = await db.connect()
  const result: Record<string, unknown> = { version: 3, exportedAt: new Date().toISOString() }
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    for (const table of dataTables) result[table] = (await client.query(`SELECT * FROM ${table}`)).rows
    result.activity_log = (await client.query(`SELECT * FROM activity_log ORDER BY id`)).rows
    result.activity_log_baselines = (await client.query(`SELECT * FROM activity_log_baselines ORDER BY table_name`)).rows
    result.history = {
      version: 1,
      description: 'snapshot — состояние при включении журнала, не дата создания. create/update/delete — сохранённые изменения; before_data/after_data — полные версии строк. navigate/export — действия в приложении. transaction_id объединяет изменения одной транзакции. Даты recorded_at — время действия, даты внутри данных — даты самих записей. История до включения журнала не восстанавливается.'
    }
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

const sections = new Set(['today','weekly','goals','operations','analytics','calendar','notes','diary',
  'flashcards','habits','laundry','supplies','shifts','weights','sleep','measurements','meals','products','workouts','data'])

export function createActivityApi(db: DB) {
  const app = express.Router()
  app.post('/api/activity', async (req, res) => {
    const { action, section, format, from, to } = req.body ?? {}
    const statementExport = action === 'export' && format === 'txt' &&
      (from === '' || validDate(from)) && (to === '' || validDate(to)) &&
      (!from || !to || from <= to)
    if (!(action === 'navigate' && sections.has(section)) && !statementExport) {
      res.status(400).json({ error: 'Некорректное действие.' })
      return
    }
    const data = statementExport ? { format, from, to } : { section }
    await db.query(`INSERT INTO activity_log(table_name,record_key,action,after_data,source)
      VALUES('app',$1,$2,$1,'app')`, [JSON.stringify(data), action])
    res.status(204).end()
  })
  app.get('/api/activity', async (req, res) => {
    const before = req.query.before
    if (before !== undefined && (typeof before !== 'string' || !/^[1-9]\d{0,18}$/.test(before) || BigInt(before) > 9223372036854775807n)) {
      res.status(400).json({ error: 'Некорректная граница истории.' })
      return
    }
    const rows = (await db.query(`SELECT id,recorded_at,transaction_id,table_name,record_key,action,source,
      COALESCE(after_data->>'title',before_data->>'title',after_data->>'name',before_data->>'name',
        after_data->>'section',after_data->>'kind',before_data->>'kind',after_data->>'key',before_data->>'key','') AS title
      FROM activity_log
      WHERE ($1::bigint IS NULL OR id<$1::bigint) ORDER BY id DESC LIMIT 51`, [before ?? null])).rows
    const entries = rows.slice(0,50)
    res.json({ entries, nextBefore: rows.length > 50 ? String(entries.at(-1)!.id) : null })
  })
  app.get('/api/activity/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) {
      res.status(400).json({ error: 'Некорректный номер действия.' })
      return
    }
    const row = (await db.query(`SELECT * FROM activity_log WHERE id=$1::bigint`, [id])).rows[0]
    if (!row) { res.status(404).json({ error: 'Действие не найдено.' }); return }
    res.json(row)
  })
  return app
}

export async function recordExport(db: DB) {
  await db.query(`INSERT INTO activity_log(table_name,record_key,action,after_data,source)
    VALUES('app','{"format":"json"}','export','{"format":"json"}','app')`)
}
