export type StatementOperation = {
  id: string
  title: string
  amount: number
  category: string
  type: 'expense' | 'income'
  date: string
  subcategory?: string
  counterparty?: string
  note?: string
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const money = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} ₽`
const dateLabel = (date: string) => date.split('-').reverse().join('.')

export function buildOperationStatement(
  operations: StatementOperation[],
  from = '',
  to = '',
  generatedAt = new Date()
) {
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) {
    throw new Error('Выбери корректные даты: начало периода не позже конца.')
  }
  // Reverse the API's newest-first order to preserve chronological order within a day.
  const selected = [...operations].reverse()
    .filter((item) => (!from || item.date >= from) && (!to || item.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date))
  const income = selected.filter((item) => item.type === 'income')
    .reduce((sum, item) => sum + Math.round(item.amount * 100), 0)
  const expense = selected.filter((item) => item.type === 'expense')
    .reduce((sum, item) => sum + Math.round(item.amount * 100), 0)
  const lines = [
    'TRELLIS — ВЫПИСКА ПО ОПЕРАЦИЯМ',
    `Период: ${from ? dateLabel(from) : 'с начала учёта'} — ${to ? dateLabel(to) : 'по последнюю запись'} (включительно)`,
    `Сформирована: ${generatedAt.toISOString()}`,
    'Валюта: RUB. Все записанные операции периода, независимо от поиска на странице.',
    `Количество операций: ${selected.length}`,
    `Доходы: ${money(income)}`,
    `Расходы: ${money(expense)}`,
    `Разница: ${money(income - expense)}`,
    'Разница и накопленный итог — доходы минус расходы, а не фактический остаток на карте.',
    'Порядок: от старых операций к новым. Время проведения операций не хранится.',
    ''
  ]
  let cumulative = 0
  selected.forEach((item, index) => {
    const cents = Math.round(item.amount * 100)
    cumulative += item.type === 'income' ? cents : -cents
    lines.push(
      `${index + 1}. ${dateLabel(item.date)} | ${item.type === 'income' ? 'Доход' : 'Расход'} | ${item.type === 'income' ? '+' : '-'}${money(cents)}`,
      `Название: ${item.title}`,
      `Категория: ${item.category}`,
      `Подкатегория: ${item.subcategory || '—'}`,
      `Контрагент / место: ${item.counterparty || '—'}`,
      `Комментарий: ${item.note || '—'}`,
      `ID: ${item.id}`,
      `Накопленный итог с начала периода: ${money(cumulative)}`,
      ''
    )
  })
  if (!selected.length) lines.push('В выбранном периоде операций нет.')
  return {
    text: lines.join('\n'),
    filename: `trellis-statement_${from || 'start'}_${to || 'end'}.txt`,
    count: selected.length
  }
}
