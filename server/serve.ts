import express from 'express'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createApi } from './api.js'
import { createPersonalApi } from './personal-api.js'
import type { DB } from './database.js'

function openBrowser(url: string) {
  if (process.platform !== 'darwin') return
  const child = spawn('open', [url], { stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}
export async function startServer(
  db: DB & { end?: () => Promise<void> },
  options: { dev: boolean; open?: boolean; port?: number }
) {
  const root = await realpath(fileURLToPath(new URL('..', import.meta.url)))
  const identity = createHash('sha256')
    .update(
      root +
        '|' +
        (process.env.PGDATABASE || 'life_dashboard') +
        '|' +
        (process.env.DATABASE_URL || '')
    )
    .digest('hex')
    .slice(0, 20)
  const preferred = options.port ?? Number(process.env.PORT || 5180)
  if (!Number.isInteger(preferred) || preferred < 1024 || preferred > 65000)
    throw new Error('PORT должен быть от 1024 до 65000.')
  const app = express()
  const server = createServer(app)
  app.use((req, res, next) => {
    if (req.path === '/api/health') {
      res.json({ app: 'trellis', identity, version: '1.0.0' })
      return
    }
    next()
  })
  app.use(createPersonalApi(db))
  app.use(createApi(db))
  let port = preferred
  for (; port < preferred + 20; port++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(350)
      })
      const body = (await r.json().catch(() => null)) as { app?: string; identity?: string } | null
      if (body?.app === 'trellis' && body.identity === identity) {
        const url = `http://localhost:${port}`
        console.log(`Trellis уже работает: ${url}`)
        if (options.open) openBrowser(url)
        await db.end?.()
        return null
      }
    } catch {
      /* Проверяем порт фактическим listen. */
    }
    const listening = await new Promise<boolean>((resolve, reject) => {
      const onError = (e: NodeJS.ErrnoException) => {
        server.off('listening', onListen)
        e.code === 'EADDRINUSE' ? resolve(false) : reject(e)
      }
      const onListen = () => {
        server.off('error', onError)
        resolve(true)
      }
      server.once('error', onError)
      server.once('listening', onListen)
      server.listen(port, '127.0.0.1')
    })
    if (listening) break
  }
  if (port === preferred + 20) throw new Error('Не найден свободный порт в диапазоне запуска.')
  let closeVite: (() => Promise<void>) | undefined
  if (options.dev) {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      root,
      configFile: path.join(root, 'vite.config.ts'),
      server: { middlewareMode: true, ws: { server } },
      appType: 'custom'
    })
    closeVite = () => vite.close()
    app.use(vite.middlewares)
    app.use(async (req, res, next) => {
      if (req.method !== 'GET') return next()
      try {
        const html = await vite.transformIndexHtml(
          req.originalUrl,
          await readFile(path.join(root, 'index.html'), 'utf8')
        )
        res.type('html').send(html)
      } catch (e) {
        next(e)
      }
    })
  } else {
    app.use(express.static(path.join(root, 'dist')))
    app.use((_req, res) => res.sendFile(path.join(root, 'dist/index.html')))
  }
  const url = `http://localhost:${port}`
  console.log(`\nTrellis запущен: ${url}\nИнтерфейс и API работают вместе. Остановка: Control + C.\n`)
  if (options.open) openBrowser(url)
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    server.closeAllConnections()
    await closeVite?.()
    await new Promise<void>((r) => server.close(() => r()))
    await db.end?.()
  }
  const stop = () => void close().then(() => process.exit(0))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return { url, server, close }
}
