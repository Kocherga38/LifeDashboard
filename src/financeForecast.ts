export type ForecastTemplate = {
  id: string
  title: string
  amount: number
  type: 'expense' | 'income'
  templateKind: 'quick' | 'recurring'
  recurrence: 'weekly' | 'monthly' | 'yearly' | null
  nextDate: string | null
}

export type ForecastEvent = {
  templateId: string
  title: string
  amount: number
  type: 'expense' | 'income'
  date: string
}

export type FinancialForecast = {
  expenseTotal: number
  incomeTotal: number
  forecastBalance: number
  paymentCount: number
  overdueCount: number
  nearestExpense: ForecastEvent | null
  firstShortfall: { date: string; amount: number } | null
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const toCents = (value: number) => Math.round(value * 100)
const fromCents = (value: number) => value / 100

function advanceDate(date: string, recurrence: NonNullable<ForecastTemplate['recurrence']>) {
  const [year, month, day] = date.split('-').map(Number)
  if (recurrence === 'weekly') {
    return new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10)
  }

  const targetMonth = recurrence === 'yearly' ? month - 1 : month
  const targetYear = recurrence === 'yearly' ? year + 1 : year + Math.floor(targetMonth / 12)
  const normalizedMonth = targetMonth % 12
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()

  return new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10)
}

export function buildFinancialForecast(
  templates: ForecastTemplate[],
  baseBalance: number,
  startDate: string,
  endDate: string
): FinancialForecast {
  const events: ForecastEvent[] = []

  if (datePattern.test(startDate) && datePattern.test(endDate) && startDate <= endDate) {
    for (const template of templates) {
      if (
        template.templateKind !== 'recurring' ||
        !template.recurrence ||
        !template.nextDate ||
        !datePattern.test(template.nextDate)
      ) {
        continue
      }

      let date = template.nextDate
      for (let occurrence = 0; date <= endDate && occurrence < 400; occurrence++) {
        events.push({
          templateId: template.id,
          title: template.title,
          amount: template.amount,
          type: template.type,
          date
        })

        const nextDate = advanceDate(date, template.recurrence)
        if (nextDate <= date) break
        date = nextDate
      }
    }
  }

  events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.type === b.type ? a.title.localeCompare(b.title, 'ru') : a.type === 'income' ? -1 : 1)
  )

  let expenseCents = 0
  let incomeCents = 0
  for (const event of events) {
    if (event.type === 'expense') expenseCents += toCents(event.amount)
    else incomeCents += toCents(event.amount)
  }

  let runningCents = toCents(baseBalance)
  let firstShortfall: FinancialForecast['firstShortfall'] = null
  for (const date of [...new Set(events.map((event) => event.date))]) {
    const daily = events.filter((event) => event.date === date)
    runningCents += daily
      .filter((event) => event.type === 'income')
      .reduce((sum, event) => sum + toCents(event.amount), 0)
    runningCents -= daily
      .filter((event) => event.type === 'expense')
      .reduce((sum, event) => sum + toCents(event.amount), 0)

    if (!firstShortfall && runningCents < 0) {
      firstShortfall = { date, amount: fromCents(-runningCents) }
    }
  }

  return {
    expenseTotal: fromCents(expenseCents),
    incomeTotal: fromCents(incomeCents),
    forecastBalance: fromCents(toCents(baseBalance) + incomeCents - expenseCents),
    paymentCount: events.filter((event) => event.type === 'expense').length,
    overdueCount: events.filter((event) => event.type === 'expense' && event.date < startDate)
      .length,
    nearestExpense: events.find((event) => event.type === 'expense') ?? null,
    firstShortfall
  }
}
