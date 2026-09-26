export type MoneySettings = { balance: number; netPerShift: number; shiftsPerMonth: number; monthlySpending: number; rent: number; rentDay: number; savingsTarget: number; purchasePrice: number }
export type PlannedShift = { id: string; date: string; expectedPay: number; note: string; received: boolean }
export type MonthProjection = { month: string; balance: number; earnings: number; spending: number }

const dateAfter = (month: string, day: number) => {
  const [year, value] = month.split('-').map(Number)
  const last = new Date(year, value, 0).getDate()
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`
}
const nextMonth = (month: string) => {
  const [year, value] = month.split('-').map(Number)
  const d = new Date(Date.UTC(year, value, 1))
  return d.toISOString().slice(0, 7)
}
export function nextRentDate(start: string, rentDay: number) {
  const month = start.slice(0, 7)
  return dateAfter(dateAfter(month, rentDay) >= start ? month : nextMonth(month), rentDay)
}
export function cashAtNextRent(s: MoneySettings, shifts: PlannedShift[], start: string) {
  const due = nextRentDate(start, s.rentDay)
  const earnings = shifts.filter((x) => !x.received && x.date >= start && x.date <= due).reduce((sum, x) => sum + Number(x.expectedPay), 0)
  let spending = 0
  for (let d = new Date(`${start}T12:00:00Z`); d.toISOString().slice(0, 10) < due; d.setUTCDate(d.getUTCDate() + 1)) {
    const days = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    spending += s.monthlySpending / days
  }
  return s.balance + earnings - spending - s.rent
}
export function projectMoney(s: MoneySettings, shifts: PlannedShift[], start: string, withPurchase = false): MonthProjection[] {
  const startMonth = start.slice(0, 7)
  let balance = s.balance - (withPurchase ? s.purchasePrice : 0)
  const months: MonthProjection[] = []
  let month = startMonth
  for (let i = 0; i < 12; i++, month = nextMonth(month)) {
    const earnings = i === 0 ? shifts.filter((x) => !x.received && x.date >= start && x.date.startsWith(month)).reduce((n, x) => n + Number(x.expectedPay), 0) : s.shiftsPerMonth * s.netPerShift
    const [year, value] = month.split('-').map(Number)
    const days = new Date(Date.UTC(year, value, 0)).getUTCDate()
    const remaining = i === 0 ? (days - Number(start.slice(8)) + 1) / days : 1
    const spending = s.monthlySpending * remaining + (i !== 0 || dateAfter(month, s.rentDay) >= start ? s.rent : 0)
    balance += earnings - spending
    months.push({ month, balance, earnings, spending })
  }
  return months
}
export const firstTargetMonth = (rows: MonthProjection[], target: number) => rows.find((x) => x.balance >= target)?.month ?? null
