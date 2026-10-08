import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { startServer, lanUrls } from '../server/serve.js'
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

test('LAN listens outside loopback, serves UI and all APIs, and refuses cross-site writes', async () => {
  const probe = createServer()
  probe.listen(0,'127.0.0.1')
  await new Promise<void>((resolve) => probe.once('listening',resolve))
  const port = (probe.address() as {port:number}).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  const queries: string[] = []
  let closed = 0
  const query: DB['query'] = async (sql) => { queries.push(sql); return { rows:[] } }
  const db = {query,connect:async () => ({query,release() {}}),end:async () => { closed++ }}
  const running = await startServer(db,{dev:true,port,lan:true})
  assert.ok(running)
  try {
    assert.equal((running.server.address() as {address:string}).address,'0.0.0.0')
    // Use a real interface when discovery is allowed, otherwise verify the all-interface listener.
    const url = running.lanUrls[0] ?? running.url
    const health = await fetch(url+'/api/health').then((r) => r.json())
    assert.equal(health.lan,true)
    assert.match(await fetch(url).then((r) => r.text()), /id="root"/)
    const source = await fetch(url+'/src/main.tsx')
    assert.equal(source.status,200)
    assert.match(source.headers.get('content-type')!, /javascript/)
    assert.match(await source.text(), /createRoot/)
    for (const path of ['/api/laundry/items','/api/supplies/items','/api/events','/api/diary']) {
      assert.deepEqual(await fetch(url+path).then((r) => r.json()),[])
    }
    for (const path of ['/api/diary','/api/events','/api/expenses','/api/laundry/items','/api/supplies/purchases']) {
      const before = queries.length
      const response = await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://unrelated.example'},body:'{}'})
      assert.equal(response.status,403,path)
      assert.equal(queries.length,before,path)
    }
    const response = await fetch(url+'/api/activity',{method:'POST',headers:{'Content-Type':'application/json',Origin:url},body:JSON.stringify({action:'navigate',section:'supplies'})})
    assert.equal(response.status,204)
    assert.equal(await startServer(db,{dev:false,port,lan:true}),null)
    assert.equal(closed,1)
    await assert.rejects(startServer(db,{dev:false,port,lan:false}), /Останови его/)
    assert.equal((await fetch(url+'/api/health').then((r) => r.json())).lan,true)
  } finally { await running.close() }
})

test('LAN launch does not silently reuse an existing local-only server', async () => {
  const probe = createServer()
  probe.listen(0,'127.0.0.1')
  await new Promise<void>((resolve) => probe.once('listening',resolve))
  const port = (probe.address() as {port:number}).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  const query: DB['query'] = async () => ({rows:[]})
  const db = {query,connect:async () => ({query,release() {}}),end:async () => {}}
  const running = await startServer(db,{dev:false,port,lan:false})
  assert.ok(running)
  try {
    assert.equal((running.server.address() as {address:string}).address,'127.0.0.1')
    assert.deepEqual(running.lanUrls,[])
    await assert.rejects(startServer(db,{dev:false,port,lan:true}), /npm start -- --lan/)
    assert.equal((await fetch(running.url+'/api/health').then((r) => r.json())).lan,false)
  } finally { await running.close() }
})


test('phone URLs use external IPv4 addresses, the actual port and no duplicates', () => {
  const entry = (address: string, internal = false, family = 'IPv4') => ({address,internal,family,netmask:'255.255.255.0',mac:'00:00:00:00:00:00',cidr:`${address}/24`})
  assert.deepEqual(lanUrls(5181, {
    lo: [entry('127.0.0.1',true)],
    en0: [entry('192.168.1.133'),entry('fe80::1',false,'IPv6')],
    en1: [entry('192.168.1.133')]
  } as ReturnType<typeof import('node:os').networkInterfaces>), ['http://192.168.1.133:5181'])
  assert.deepEqual(lanUrls(5180,{}),[])
})
