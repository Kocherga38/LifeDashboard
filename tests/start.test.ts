import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { startServer } from '../server/serve.js'
import type { DB } from '../server/database.js'

test('Занятый порт обходится, повторный запуск находит работающий экземпляр', async () => {
  const blocker = createServer((_req, res) => res.end('Другое приложение'))
  blocker.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => blocker.once('listening', resolve))
  const port = (blocker.address() as { port: number }).port
  let closed = 0
  const query: DB['query'] = async () => ({ rows: [] })
  const db = {
    query,
    connect: async () => ({ query, release() {} }),
    end: async () => {
      closed++
    }
  }
  let running: Awaited<ReturnType<typeof startServer>> = null
  try {
    running = await startServer(db, { dev: false, port })
    assert.ok(running)
    assert.equal(new URL(running.url).port, String(port + 1))
    const health = await fetch(running.url + '/api/health').then((r) => r.json())
    assert.equal(health.app, 'trellis')
    assert.equal(await startServer(db, { dev: false, port }), null)
    assert.equal(closed, 1)
  } finally {
    await running?.close()
    await new Promise<void>((resolve) => blocker.close(() => resolve()))
  }
})
