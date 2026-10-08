import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { testDatabase } from './db.js'
import { migrate } from '../server/database.js'
import { createApi } from '../server/api.js'
import { supplyForecast, addDays, dayDifference } from '../shared/household.js'
import type { SupplyItem, SupplyPurchase } from '../shared/household.js'

test('прогноз отделяет накопления от расходов и предлагает интервал только по истории', () => {
  const item: SupplyItem = { id:'coffee', name:'Кофе', details:'', category:'Продукты', intervalDays:60, runningLow:false }
  const p = (date: string, amount = 1800): SupplyPurchase => ({id:date,itemId:item.id,date,amount,quantity:'1 кг',note:'',operationId:null,ownsOperation:false,category:'Продукты'})
  const f = supplyForecast(item,[p('2026-10-01'),p('2026-08-02'),p('2026-06-03'),p('2027-01-01',9999)],'2026-10-08')
  assert.equal(f.nextDate,'2026-11-30'); assert.equal(f.monthlyReserve,913.13); assert.equal(f.suggestedDays,60)
  const unknown = supplyForecast({...item,intervalDays:null},[p('2026-10-01'),p('2026-08-02'),p('2026-06-03')],'2026-10-08')
  assert.equal(unknown.nextDate,null); assert.equal(unknown.monthlyReserve,null); assert.equal(unknown.suggestedDays,60)
  assert.equal(supplyForecast(item,[],'2026-10-08').last,null)
  assert.equal(addDays('2024-02-28',2),'2024-03-01'); assert.equal(dayDifference('2026-12-31','2027-01-01'),1)
})

test('старые стирки сохраняются; массовые отметки атомарны; покупки и расходы не дублируются и входят в историю', async () => {
  const db = await testDatabase(), oldItem = randomUUID(), oldWash = randomUUID()
  await db.query(`CREATE TABLE laundry_items(id UUID PRIMARY KEY,name VARCHAR(120) NOT NULL,details VARCHAR(250) NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
  await db.query(`CREATE TABLE laundry_washes(id UUID PRIMARY KEY,item_id UUID NOT NULL REFERENCES laundry_items(id) ON DELETE CASCADE,washed_on DATE NOT NULL,note VARCHAR(500) NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
  await db.query(`INSERT INTO laundry_items(id,name) VALUES($1,'Джинсы')`,[oldItem])
  await db.query(`INSERT INTO laundry_washes(id,item_id,washed_on) VALUES($1,$2,'2026-09-25')`,[oldWash,oldItem])
  await migrate(db); await migrate(db)
  const server = createApi(db).listen(0,'127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening',resolve))
  const url = `http://127.0.0.1:${(server.address() as {port:number}).port}`
  const request = async (path:string, method='GET', body?:unknown) => {
    const r = await fetch(url+path,{method,headers:{'Content-Type':'application/json'},body:body === undefined ? undefined : JSON.stringify(body)})
    return {status:r.status,body:r.status === 204 ? null : await r.json()}
  }
  const count = async (table:string) => (await db.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n
  try {
    assert.equal((await request('/api/laundry/items')).body[0].id,oldItem)
    assert.equal((await request('/api/laundry/washes')).body[0].id,oldWash)
    assert.equal((await request('/api/laundry/items')).body[0].intervalDays,null)
    const shirt = (await request('/api/laundry/items','POST',{name:'Футболка',intervalDays:14})).body
    const batch = {itemIds:[oldItem,shirt.id],date:'2026-10-01',note:'30°C'}
    const added = await request('/api/laundry/washes','POST',batch)
    assert.equal(added.status,201); assert.equal(added.body.length,2)
    assert.equal((await request('/api/laundry/washes','POST',batch)).body.length,0)
    const changes = (await db.query(`SELECT * FROM activity_log WHERE table_name='laundry_washes' AND action='create'`)).rows
    assert.equal(changes.length,2); assert.equal(changes[0].transaction_id,changes[1].transaction_id)
    const beforeFailure = await count('activity_log')
    assert.equal((await request('/api/laundry/washes','POST',{...batch,itemIds:[shirt.id,randomUUID()],date:'2026-10-02'})).status,400)
    assert.equal(await count('activity_log'),beforeFailure)
    assert.equal((await request('/api/laundry/washes','POST',{...batch,date:'2026-02-30'})).status,400)
    assert.equal((await request('/api/laundry/washes','POST',{...batch,date:'2099-01-01'})).status,400)
    assert.equal((await request(`/api/laundry/washes/${added.body[0].id}`,'PUT',{date:'2026-09-25'})).status,400)
    assert.equal((await request(`/api/laundry/washes/${added.body[1].id}`,'PUT',{date:'2026-10-02',note:'Исправил'})).status,200)
    assert.equal((await request(`/api/laundry/items/${shirt.id}`,'DELETE')).status,204)
    assert.ok((await db.query(`SELECT * FROM activity_log WHERE table_name='laundry_washes' AND action='delete'`)).rows.length)

    const coffee = (await request('/api/supplies/items','POST',{name:'Кофе',category:'Продукты',intervalDays:60,runningLow:true})).body
    const input = {itemId:coffee.id,date:'2026-10-01',amount:1800,quantity:'1 кг',finance:'create'}
    const purchase = await request('/api/supplies/purchases','POST',input)
    assert.equal(purchase.status,201); assert.equal(purchase.body.amount,1800); assert.ok(purchase.body.ownsOperation)
    assert.equal(await count('expenses'),1)
    assert.equal((await request('/api/supplies/items')).body[0].runningLow,false)
    const expense = (await request('/api/expenses')).body[0]
    assert.equal(expense.id,purchase.body.operationId)
    const logged = (await db.query(`SELECT * FROM activity_log WHERE table_name IN ('supply_purchases','expenses') AND action='create'`)).rows
    assert.equal(logged[0].transaction_id,logged[1].transaction_id)
    assert.equal((await request(`/api/supplies/purchases/${purchase.body.id}`,'PUT',{...input,amount:1900,date:'2026-10-02'})).status,200)
    assert.equal(await count('expenses'),1); assert.equal((await request('/api/expenses')).body[0].amount,1900)
    assert.equal((await request(`/api/expenses/${expense.id}`,'PUT',{...expense,amount:2000,date:'2026-10-03'})).status,200)
    assert.equal((await request('/api/supplies/purchases')).body[0].amount,2000)
    assert.equal((await request('/api/supplies/purchases')).body[0].date,'2026-10-03')
    assert.equal((await request('/api/supplies/purchases','POST',{...input,finance:'link',operationId:expense.id})).status,400)
    assert.equal((await request(`/api/supplies/purchases/${purchase.body.id}`,'PUT',{...input,finance:'none'})).status,400)
    assert.equal((await request(`/api/supplies/purchases/${purchase.body.id}`,'DELETE')).status,204)
    assert.equal(await count('expenses'),1)
    const linked = (await request('/api/supplies/purchases','POST',{...input,finance:'link',operationId:expense.id})).body
    assert.equal(linked.amount,2000); assert.equal(linked.date,'2026-10-03'); assert.equal(linked.ownsOperation,false)
    assert.equal((await request(`/api/supplies/purchases/${linked.id}?deleteExpense=true`,'DELETE')).status,400)
    assert.equal(await count('supply_purchases'),1)
    await request(`/api/expenses/${expense.id}`,'DELETE')
    const detached = (await request('/api/supplies/purchases')).body[0]
    assert.equal(detached.operationId,null); assert.equal(detached.amount,2000); assert.equal(detached.date,'2026-10-03'); assert.equal(detached.ownsOperation,false)
    const own = (await request('/api/supplies/purchases','POST',input)).body
    assert.equal((await request(`/api/supplies/purchases/${own.id}?deleteExpense=true`,'DELETE')).status,204)
    assert.equal(await count('expenses'),0)
    const noMoney = await request('/api/supplies/purchases','POST',{...input,finance:'none'})
    assert.equal(noMoney.status,201); assert.equal(await count('expenses'),0)
    await request('/api/supplies/purchases','POST',input)
    const backup = (await request('/api/export')).body
    assert.equal(backup.supply_purchases.length,3); assert.equal(backup.supply_items[0].id,coffee.id)
    assert.ok(backup.activity_log.some((x:any) => x.table_name === 'laundry_washes' && x.action === 'snapshot'))
    for (const section of ['laundry','supplies']) assert.equal((await request('/api/activity','POST',{action:'navigate',section})).status,204)
    const order = (await request('/api/sidebar-order')).body.order
    assert.ok(order.includes('laundry')); assert.ok(order.includes('supplies'))
    assert.equal((await request('/api/sidebar-order','PUT',{order:order.reverse()})).status,200)
    const createdCount = await count('activity_log')
    // Fail after creating the expense: the transaction must roll back both rows and log.
    await db.query(`CREATE FUNCTION reject_supply_test() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$ LANGUAGE plpgsql`)
    await db.query(`CREATE TRIGGER reject_supply_test BEFORE INSERT ON supply_purchases FOR EACH ROW EXECUTE FUNCTION reject_supply_test()`)
    const expenseCount = await count('expenses')
    assert.equal((await request('/api/supplies/purchases','POST',input)).status,503)
    assert.equal(await count('expenses'),expenseCount); assert.equal(await count('activity_log'),createdCount)
    await db.query(`DROP TRIGGER reject_supply_test ON supply_purchases`)
    await request(`/api/supplies/items/${coffee.id}`,'DELETE')
    assert.equal(await count('supply_purchases'),0); assert.equal(await count('expenses'),expenseCount)
    assert.ok((await db.query(`SELECT * FROM activity_log WHERE table_name='supply_purchases' AND action='delete'`)).rows.length)
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await db.end() }
})
