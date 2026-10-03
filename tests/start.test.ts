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
    assert.deepEqual(await fetch(running.url + '/api/events').then((r) => r.json()), [])
    assert.equal(await startServer(db, { dev: false, port }), null)
    assert.equal(closed, 1)
  } finally {
    await running?.close()
    await new Promise<void>((resolve) => blocker.close(() => resolve()))
  }
})


test('повторный запуск не переиспользует устаревший сервер Trellis', async () => {
  const query: DB['query'] = async () => ({ rows: [] })
  const db = { query, connect: async () => ({ query, release() {} }), end: async () => {} }
  const probe = await startServer(db, { dev: false, port: 5380 })
  assert.ok(probe)
  const health = await fetch(probe.url + '/api/health').then((r) => r.json())
  const port = Number(new URL(probe.url).port)
  await probe.close()
  const legacy = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ app: 'trellis', identity: health.identity, revision: 'old-server' }))
  })
  legacy.listen(port, '127.0.0.1')
  await new Promise<void>((resolve) => legacy.once('listening', resolve))
  let running: Awaited<ReturnType<typeof startServer>> = null
  try {
    running = await startServer(db, { dev: false, port })
    assert.ok(running)
    assert.equal(Number(new URL(running.url).port), port + 1)
    const current = await fetch(running.url + '/api/health').then((r) => r.json())
    assert.equal(current.revision, health.revision)
  } finally {
    await running?.close()
    await new Promise<void>((resolve) => legacy.close(() => resolve()))
  }
})
