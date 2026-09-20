import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFinancialForecast } from '../src/financeForecast.js'
import type { ForecastTemplate } from '../src/financeForecast.js'

const templates: ForecastTemplate[] = [
  {
    id: 'water',
    title: 'Вода',
    amount: 24.99,
    type: 'expense',
    templateKind: 'quick',
    recurrence: null,
    nextDate: null
  },
  {
    id: 'subscription',
    title: 'Подписка',
    amount: 800,
    type: 'expense',
    templateKind: 'recurring',
    recurrence: 'monthly',
    nextDate: '2026-09-24'
  },
  {
    id: 'salary',
    title: 'Оплата смены',
    amount: 500,
    type: 'income',
    templateKind: 'recurring',
    recurrence: 'monthly',
    nextDate: '2026-09-23'
  }
]

test('прогноз отделяет факт от будущих обязательств и учитывает регулярные доходы', () => {
  const result = buildFinancialForecast(templates, 1000, '2026-09-20', '2026-09-30')

  assert.equal(result.expenseTotal, 800)
  assert.equal(result.incomeTotal, 500)
  assert.equal(result.forecastBalance, 700)
  assert.equal(result.paymentCount, 1)
  assert.equal(result.overdueCount, 0)
  assert.equal(result.nearestExpense?.title, 'Подписка')
  assert.equal(result.firstShortfall, null)
})

test('прогноз показывает первую дату и сумму кассового разрыва', () => {
  const result = buildFinancialForecast(templates, 100, '2026-09-20', '2026-09-30')

  assert.deepEqual(result.firstShortfall, { date: '2026-09-24', amount: 200 })
  assert.equal(result.forecastBalance, -200)
})

test('перенесённый после оплаты шаблон не задваивает старый платёж', () => {
  const paid = templates.map((template) =>
    template.id === 'subscription' ? { ...template, nextDate: '2026-10-24' } : template
  )
  const result = buildFinancialForecast(paid, 1000, '2026-09-20', '2026-09-30')

  assert.equal(result.expenseTotal, 0)
  assert.equal(result.paymentCount, 0)
  assert.equal(result.forecastBalance, 1500)
})

test('просроченные платежи не исчезают из будущего прогноза', () => {
  const overdue = templates.map((template) =>
    template.id === 'subscription' ? { ...template, nextDate: '2026-08-24' } : template
  )
  const result = buildFinancialForecast(overdue, 2000, '2026-09-20', '2026-09-30')

  assert.equal(result.expenseTotal, 1600)
  assert.equal(result.paymentCount, 2)
  assert.equal(result.overdueCount, 1)
  assert.equal(result.nearestExpense?.date, '2026-08-24')
})
