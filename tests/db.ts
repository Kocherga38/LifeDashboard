import { PGlite } from '@electric-sql/pglite'
import type { DB } from '../server/database.js'
// Изолированный PostgreSQL/WASM только для тестов. Приложение использует pg и Postgres.app.
export async function testDatabase(directory?: string) {
  const engine = new PGlite(directory)
  await engine.waitReady
  const query: DB['query'] = async (text, values) => {
    const result = await engine.query(text, values)
    return { rows: result.rows as Record<string, any>[], rowCount: result.affectedRows }
  }
  const db: DB & { end: () => Promise<void> } = {
    query,
    connect: async () => ({ query, release() {} }),
    end: () => engine.close()
  }
  return db
}
