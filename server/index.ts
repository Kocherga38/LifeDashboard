import { openDatabase, migrate } from './database.js'
import { startServer } from './serve.js'

try {
  const db = await openDatabase()
  await migrate(db)
  await startServer(db, {
    dev: !process.argv.includes('--built'),
    open: process.env.NO_OPEN !== '1'
  })
} catch (error) {
  console.error('\nНе удалось запустить LIFE.\n')
  const e = error as { code?: string; message?: string }
  if (['ECONNREFUSED', 'ETIMEDOUT'].includes(e.code || '') || e.message?.includes('timeout')) {
    console.error('Открой Postgres.app → Start. Затем снова запусти приложение.')
  } else if (['28P01', '28000', '42501'].includes(e.code || '')) {
    console.error(
      'PostgreSQL отказал в доступе. Разреши подключение Node/Terminal в Postgres.app.\nЕсли ты задавал пароль, укажи его в .env (образец: .env.example).'
    )
  } else console.error(e.message)
  process.exit(1)
}
