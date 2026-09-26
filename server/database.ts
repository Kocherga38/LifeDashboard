import pg from 'pg'
import { userInfo } from 'node:os'

export interface Queryable {
  query(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Record<string, any>[]; rowCount?: number | null }>
}
export interface DB extends Queryable {
  connect(): Promise<Queryable & { release(): void }>
}
export function connectionOptions() {
  return process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 4000 }
    : {
        host: process.env.PGHOST || '127.0.0.1',
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE || 'life_dashboard',
        user: process.env.PGUSER || userInfo().username,
        ...(process.env.PGPASSWORD ? { password: process.env.PGPASSWORD } : {}),
        connectionTimeoutMillis: 4000
      }
}
export async function openDatabase() {
  const options = connectionOptions()
  const pool = new pg.Pool(options)
  try {
    await pool.query('SELECT 1')
  } catch (error) {
    if ((error as { code?: string }).code !== '3D000' || process.env.DATABASE_URL) {
      await pool.end()
      throw error
    }
    const admin = new pg.Pool({ ...options, database: 'postgres' })
    try {
      const name = process.env.PGDATABASE || 'life_dashboard'
      await admin.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`)
    } catch (e) {
      if ((e as { code?: string }).code !== '42P04') throw e
    } finally {
      await admin.end()
    }
    await pool.query('SELECT 1')
  }
  pool.on('error', (e) => console.error('Соединение с PostgreSQL:', e.message))
  return pool
}
export async function migrate(db: DB) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `CREATE TABLE IF NOT EXISTS expenses (id UUID PRIMARY KEY, title VARCHAR(100) NOT NULL, amount NUMERIC(12,2) NOT NULL CHECK(amount>0), category VARCHAR(100) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
    )
    await client.query(
      `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'expense' CHECK(type IN ('expense','income'))`
    )
    await client.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS operation_date DATE`)
    await client.query(
      `UPDATE expenses SET operation_date=(created_at AT TIME ZONE 'Europe/Moscow')::date WHERE operation_date IS NULL`
    )
    await client.query(`ALTER TABLE expenses ALTER COLUMN operation_date SET NOT NULL`)
    for (const column of ['subcategory', 'counterparty', 'note'])
      await client.query(
        `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS ${column} TEXT NOT NULL DEFAULT ''`
      )
    await client.query(
      `CREATE INDEX IF NOT EXISTS expenses_operation_date_idx ON expenses(operation_date)`
    )
    await client.query(
      `CREATE TABLE IF NOT EXISTS budgets(id UUID PRIMARY KEY,category VARCHAR(100) NOT NULL,amount NUMERIC(12,2) NOT NULL CHECK(amount>0),month DATE NOT NULL CHECK(EXTRACT(DAY FROM month)=1), UNIQUE(month,category))`
    )
    await client.query(
      `CREATE TABLE IF NOT EXISTS operation_categories(
        id UUID PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('expense','income')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    )
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS operation_categories_name_idx ON operation_categories(type,lower(name))`)
    await client.query(
      `CREATE TABLE IF NOT EXISTS operation_templates(
        id UUID PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        amount NUMERIC(12,2) NOT NULL CHECK(amount>0),
        category VARCHAR(100) NOT NULL,
        type TEXT NOT NULL DEFAULT 'expense' CHECK(type IN ('expense','income')),
        subcategory TEXT NOT NULL DEFAULT '',
        counterparty TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        template_kind TEXT NOT NULL DEFAULT 'quick' CHECK(template_kind IN ('quick','recurring')),
        recurrence TEXT CHECK(recurrence IN ('weekly','monthly','yearly')),
        next_date DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK(
          (template_kind='quick' AND recurrence IS NULL AND next_date IS NULL) OR
          (template_kind='recurring' AND recurrence IS NOT NULL AND next_date IS NOT NULL)
        )
      )`
    )
    await client.query(
      `CREATE TABLE IF NOT EXISTS journal_entries(id UUID PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('shifts','weights','measurements','products','meals','workouts')),data JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
    )
    await client.query(`CREATE INDEX IF NOT EXISTS journal_kind_idx ON journal_entries(kind)`)
    await client.query(
      `CREATE TABLE IF NOT EXISTS sleep_entries(
        id UUID PRIMARY KEY,
        slept_at TIMESTAMP NOT NULL,
        woke_at TIMESTAMP NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        dream TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK(woke_at > slept_at AND woke_at <= slept_at + INTERVAL '36 hours')
      )`
    )
    await client.query(`ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS dream TEXT NOT NULL DEFAULT ''`)
    await client.query(`CREATE INDEX IF NOT EXISTS sleep_woke_at_idx ON sleep_entries(woke_at DESC)`)
    await client.query(
      `CREATE TABLE IF NOT EXISTS tasks(id UUID PRIMARY KEY,title VARCHAR(200) NOT NULL,task_date DATE NOT NULL,completed BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
    )
    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_type TEXT NOT NULL DEFAULT 'none' CHECK(recurrence_type IN ('none','interval','weekdays'))`)
    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS interval_days INTEGER`)
    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS weekdays JSONB NOT NULL DEFAULT '[]'::jsonb`)
    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT 'default'`)
    await client.query(`CREATE INDEX IF NOT EXISTS tasks_date_idx ON tasks(task_date)`)
    await client.query(
      `CREATE TABLE IF NOT EXISTS task_occurrences(task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,occurrence_date DATE NOT NULL,completed BOOLEAN NOT NULL DEFAULT FALSE,PRIMARY KEY(task_id,occurrence_date))`
    )
    await client.query(`ALTER TABLE task_occurrences ADD COLUMN IF NOT EXISTS moved_to_date DATE`)
    await client.query(`CREATE INDEX IF NOT EXISTS task_occurrences_date_idx ON task_occurrences(occurrence_date)`)
    await client.query(`CREATE INDEX IF NOT EXISTS task_occurrences_moved_date_idx ON task_occurrences(moved_to_date) WHERE moved_to_date IS NOT NULL`)
    await client.query(
      `CREATE TABLE IF NOT EXISTS note_folders(id UUID PRIMARY KEY,name VARCHAR(120) NOT NULL,parent_id UUID REFERENCES note_folders(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
    )
    await client.query(
      `CREATE TABLE IF NOT EXISTS notes(id UUID PRIMARY KEY,folder_id UUID REFERENCES note_folders(id) ON DELETE CASCADE,title VARCHAR(200) NOT NULL,content TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
    )
    await client.query(`CREATE INDEX IF NOT EXISTS notes_folder_idx ON notes(folder_id)`)
    await client.query(
      `CREATE TABLE IF NOT EXISTS diary_entries(id UUID PRIMARY KEY,entry_date DATE NOT NULL,title VARCHAR(200) NOT NULL DEFAULT '',content TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
    )
    await client.query(`CREATE INDEX IF NOT EXISTS diary_date_idx ON diary_entries(entry_date DESC)`)
    await client.query(
      `CREATE TABLE IF NOT EXISTS flashcards(id UUID PRIMARY KEY,deck VARCHAR(100) NOT NULL DEFAULT 'Основная',front TEXT NOT NULL,back TEXT NOT NULL,due_date DATE NOT NULL DEFAULT CURRENT_DATE,interval_days INTEGER NOT NULL DEFAULT 0,ease_factor NUMERIC(4,2) NOT NULL DEFAULT 2.50,repetitions INTEGER NOT NULL DEFAULT 0,lapses INTEGER NOT NULL DEFAULT 0,last_reviewed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
    )
    await client.query(`CREATE INDEX IF NOT EXISTS flashcards_due_idx ON flashcards(due_date)`)
    await client.query(
      `CREATE TABLE IF NOT EXISTS habits(id UUID PRIMARY KEY,name VARCHAR(120) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
    )
    await client.query(
      `CREATE TABLE IF NOT EXISTS habit_marks(habit_id UUID NOT NULL REFERENCES habits(id) ON DELETE CASCADE,mark_date DATE NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(habit_id,mark_date))`
    )
    await client.query(`CREATE INDEX IF NOT EXISTS habit_marks_date_idx ON habit_marks(mark_date)`)
    await client.query(
      `CREATE TABLE IF NOT EXISTS personal_goals(
        id UUID PRIMARY KEY,
        title VARCHAR(160) NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        next_step VARCHAR(300) NOT NULL DEFAULT '',
        due_date DATE,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed')),
        pinned BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    )
    await client.query(
      `CREATE TABLE IF NOT EXISTS monthly_goals(
        id UUID PRIMARY KEY,
        parent_id UUID NOT NULL REFERENCES personal_goals(id) ON DELETE CASCADE,
        month DATE NOT NULL CHECK(EXTRACT(DAY FROM month) = 1),
        title VARCHAR(160) NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        next_step VARCHAR(300) NOT NULL DEFAULT '',
        completed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    )
    await client.query(`CREATE INDEX IF NOT EXISTS monthly_goals_month_idx ON monthly_goals(month,parent_id)`)
    await client.query(
      `CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value JSONB NOT NULL)`
    )
    await client.query('DROP TABLE IF EXISTS imported_rows')
    await client.query('DROP TABLE IF EXISTS import_batches')
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
