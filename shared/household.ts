export type LaundryItem = { id: string; name: string; details: string; intervalDays: number | null; photo: string }
export type LaundryWash = { id: string; itemId: string; date: string; note: string }
export type SupplyItem = { id: string; name: string; details: string; category: string; intervalDays: number | null; runningLow: boolean }
export type SupplyPurchase = { id: string; itemId: string; date: string; amount: number; quantity: string; note: string; operationId: string | null; ownsOperation: boolean; category: string }
export type SupplyOperation = { id: string; title: string; date: string; amount: number; type: string; category: string }
export const dayDifference = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
export const dateLabel = (date: string) => date.split('-').reverse().join('.')
export function supplyForecast(item: SupplyItem, purchases: SupplyPurchase[], today: string) {
  const history = purchases.filter((p) => p.itemId === item.id && p.date <= today).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  const dates = [...new Set(history.map((p) => p.date))]
  const suggestedDays = dates.length >= 3 ? Math.round(dayDifference(dates.at(-1)!, dates[0]) / (dates.length - 1)) : null
  // Automatic estimates are suggestions only: stockpiling is not consumption.
  const interval = item.intervalDays
  const last = history[0] ?? null
  const lastDayAmount = last ? history.filter((p) => p.date === last.date).reduce((sum, p) => sum + p.amount, 0) : 0
  return { last, suggestedDays, nextDate: last && interval ? addDays(last.date, interval) : null,
    monthlyReserve: last && interval ? Math.round(lastDayAmount * 30.4375 / interval * 100) / 100 : null }
}
