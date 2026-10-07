import test from 'node:test'
import assert from 'node:assert/strict'
import { bookBalance } from '../src/bookBalance.js'
import { buildFinancialForecast } from '../src/financeForecast.js'

test('October rent reduces a carried September balance, not a balance reset to zero', () => {
  const operations = [
    { type: 'income' as const, amount: 20249.51, date: '2026-09-30' },
    { type: 'income' as const, amount: 17122.87, date: '2026-10-07' },
    { type: 'expense' as const, amount: 19000, date: '2026-10-01' },
    { type: 'expense' as const, amount: 10858.61, date: '2026-10-07' },
    { type: 'income' as const, amount: 10000, date: '2026-11-01' }
  ]
  assert.equal(bookBalance(operations.filter((x) => x.date.startsWith('2026-10')), '2026-10-08'), -12735.74)
  const available = bookBalance(operations, '2026-10-08')
  assert.equal(available, 7513.77)
  const forecast = buildFinancialForecast([{
    id: 'rent', title: 'Квартира', type: 'expense', amount: 19000,
    templateKind: 'recurring', recurrence: 'monthly', nextDate: '2026-11-01'
  }], available, '2026-10-08', '2026-11-07')
  assert.equal(forecast.forecastBalance, -11486.23)
  assert.deepEqual(forecast.firstShortfall, { date: '2026-11-01', amount: 11486.23 })
})

test('book balance handles cents, empty history, and future-dated expenses', () => {
  assert.equal(bookBalance([], '2026-10-08'), 0)
  assert.equal(bookBalance([
    { type: 'income', amount: 0.1, date: '2026-09-01' },
    { type: 'income', amount: 0.2, date: '2026-10-08' },
    { type: 'expense', amount: 0.3, date: '2026-10-08' },
    { type: 'expense', amount: 100, date: '2026-10-09' }
  ], '2026-10-08'), 0)
})
