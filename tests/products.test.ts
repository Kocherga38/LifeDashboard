import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { testDatabase } from './db.js'
import { migrate } from '../server/database.js'
import { createApi } from '../server/api.js'

test('Продукты сохраняют длинный состав, поддерживают старые записи и выгружают состав', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'trellis-products-'))
  let db = await testDatabase(directory)
  await migrate(db)
  const input = { name: 'Булочка с ветчиной', kcal: 280, protein: 12, fat: 10, carbs: 35, fiber: 2 }
  const legacyId = randomUUID()
  await db.query(`INSERT INTO journal_entries(id,kind,data) VALUES($1,'products',$2::jsonb)`,
    [legacyId, JSON.stringify(input)])
  const server = createApi(db).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const request = async (route: string, method = 'GET', body?: unknown) => {
    const response = await fetch(url + route, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: response.status, body: await response.json() }
  }
  const composition = `Состав\n${'Мука пшеничная, сыр «Российский», яйцо, эмульгаторы (Е322, Е471). '.repeat(120)}\nМожет содержать следы орехов и молока.`
  let savedId = ''
  try {
    assert.ok(composition.length > 5000)
    const created = await request('/api/journal/products', 'POST', { ...input, composition })
    assert.equal(created.status, 201)
    assert.equal(created.body.composition, composition)
    savedId = created.body.id
    assert.equal((await request('/api/journal/products')).body.find((row: any) => row.id === savedId).composition, composition)
    const edited = await request(`/api/journal/products/${savedId}`, 'PUT', { ...input, composition: composition + '\nСоль.' })
    assert.equal(edited.status, 200)
    assert.equal(edited.body.composition, composition + '\nСоль.')
    const exported = await request('/api/export')
    assert.equal(exported.body.journal_entries.find((row: any) => row.id === savedId).data.composition, composition + '\nСоль.')
    assert.equal((await request(`/api/journal/products/${legacyId}`, 'PUT', { ...input, composition })).status, 200)
    assert.equal((await request(`/api/journal/products/${legacyId}`, 'PUT', { ...input, composition: '' })).body.composition, '')
    assert.equal((await request('/api/journal/products', 'POST', input)).status, 201)
    assert.equal((await request('/api/journal/products', 'POST', { ...input, composition: 'я'.repeat(50000) })).status, 201)
    for (const invalid of ['я'.repeat(50001), 123, ['мука']]) {
      assert.equal((await request('/api/journal/products', 'POST', { ...input, composition: invalid })).status, 400)
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await db.end()
  }
  try {
    db = await testDatabase(directory)
    await migrate(db)
    const saved = (await db.query(`SELECT data FROM journal_entries WHERE id=$1`, [savedId])).rows[0]
    assert.equal(saved.data.composition, composition + '\nСоль.')
    assert.equal((await db.query(`SELECT data FROM journal_entries WHERE id=$1`, [legacyId])).rows[0].data.composition, '')
  } finally {
    await db.end()
    await rm(directory, { recursive: true, force: true })
  }
})
