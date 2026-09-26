import test from 'node:test'
import assert from 'node:assert/strict'
import { cashAtNextRent, firstTargetMonth, nextRentDate, projectMoney } from '../src/moneyProjection.js'
import type { MoneySettings, PlannedShift } from '../src/moneyProjection.js'

test('план смен учитывает дату квартиры и исключает полученную оплату', () => {
  const settings: MoneySettings = { balance: 10000, netPerShift: 4600, shiftsPerMonth: 12, monthlySpending: 0, rent: 20000, rentDay: 1, savingsTarget: 100000, purchasePrice: 40000 }
  const shifts: PlannedShift[] = [
    { id: 'a', date: '2026-09-27', expectedPay: 4600, note: '', received: false },
    { id: 'b', date: '2026-09-29', expectedPay: 4600, note: '', received: false }
  ]
  assert.equal(nextRentDate('2026-09-26', 1), '2026-10-01')
  assert.equal(cashAtNextRent(settings, shifts, '2026-09-26'), -800)
  assert.equal(projectMoney(settings, shifts, '2026-09-26')[0].earnings, 9200)
  shifts[0].received = true
  assert.equal(cashAtNextRent(settings, shifts, '2026-09-26'), -5400)
  const baseline = projectMoney(settings, shifts, '2026-09-26')
  const purchase = projectMoney(settings, shifts, '2026-09-26', true)
  assert.equal(purchase[0].balance, baseline[0].balance - 40000)
  assert.ok(firstTargetMonth(purchase, 100000)! > firstTargetMonth(baseline, 100000)!)
  assert.equal(nextRentDate('2027-02-10', 31), '2027-02-28')
})
