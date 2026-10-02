import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOperationStatement, type StatementOperation } from '../src/operationStatement'

const operations: StatementOperation[] = [
  { id: 'oct', date: '2026-10-01', type: 'expense', amount: 20000, title: 'Аренда', category: 'Жильё' },
  { id: 'purchase', date: '2026-09-30', type: 'expense', amount: 0.2, title: 'Покупка', category: 'Продукты', note: 'Две строки\nв комментарии', counterparty: 'Магазин', subcategory: 'Хлеб' },
  { id: 'pay', date: '2026-09-01', type: 'income', amount: 0.3, title: 'Оплата смены', category: 'Работа' },
  { id: 'old', date: '2026-08-31', type: 'income', amount: 3500, title: 'Перевод', category: 'Прочее' }
]

test('inclusive period, complete details, chronological order and exact cents', () => {
  const result = buildOperationStatement(operations, '2026-09-01', '2026-09-30')
  assert.equal(result.count, 2)
  assert.match(result.text, /Доходы: 0,30 ₽/)
  assert.match(result.text, /Расходы: 0,20 ₽/)
  assert.match(result.text, /Разница: 0,10 ₽/)
  assert.match(result.text, /Накопленный итог с начала периода: 0,10 ₽/)
  assert.match(result.text, /Подкатегория: Хлеб/)
  assert.match(result.text, /Контрагент \/ место: Магазин/)
  assert.match(result.text, /Две строки\nв комментарии/)
  assert.ok(result.text.indexOf('ID: pay') < result.text.indexOf('ID: purchase'))
  assert.doesNotMatch(result.text, /ID: oct|ID: old/)
  assert.equal(result.filename, 'trellis-statement_2026-09-01_2026-09-30.txt')
})

test('all-time, open boundaries, empty periods and source immutability', () => {
  const original = [...operations]
  assert.equal(buildOperationStatement(operations).count, 4)
  assert.equal(buildOperationStatement(operations, '', '2026-09-01').count, 2)
  assert.equal(buildOperationStatement(operations, '2026-09-30').count, 2)
  assert.deepEqual(operations, original)
  assert.match(buildOperationStatement([], '2026-09-01', '2026-09-30').text, /В выбранном периоде операций нет/)
})

test('invalid or reversed dates are rejected', () => {
  for (const [from, to] of [['2026-10-01', '2026-09-30'], ['2026-02-30', ''], ['', 'not-a-date']]) {
    assert.throws(() => buildOperationStatement(operations, from, to), /Выбери корректные даты/)
  }
})

test('same-day order follows the reverse of API newest-first order', () => {
  const sameDay = operations.slice(0, 2).map((item) => ({ ...item, date: '2026-10-01' }))
  const result = buildOperationStatement(sameDay)
  assert.ok(result.text.indexOf('ID: purchase') < result.text.indexOf('ID: oct'))
})
