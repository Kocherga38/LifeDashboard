import { validDate } from './journals.js'

export type EventRecurrence = (
  | { type: 'interval'; intervalDays: number }
  | { type: 'weekdays'; weekdays: number[] }
  | { type: 'cycle'; workDays: number; offDays: number }
) & { until?: string }

export type CalendarEvent = {
  id: string; date: string; startDate?: string; title: string; time: string
  place: string; note: string; reflection: string; recurrence: EventRecurrence | null
}

export function validateEventRecurrence(raw: unknown, start: string): EventRecurrence | null {
  if (raw == null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Некорректное повторение события.')
  const r = raw as Record<string, unknown>
  const days = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365
  let recurrence: EventRecurrence
  if (r.type === 'interval' && days(r.intervalDays)) {
    recurrence = { type: 'interval', intervalDays: r.intervalDays as number }
  } else if (r.type === 'cycle' && days(r.workDays) && days(r.offDays)) {
    recurrence = { type: 'cycle', workDays: r.workDays as number, offDays: r.offDays as number }
  } else if (r.type === 'weekdays' && Array.isArray(r.weekdays) && r.weekdays.length &&
      r.weekdays.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 6)) {
    recurrence = { type: 'weekdays', weekdays: [...new Set<number>(r.weekdays)].sort() }
  } else {
    throw new Error('Проверь повторение: дни от 1 до 365 или хотя бы один день недели.')
  }
  if (r.until !== undefined) {
    if (!validDate(r.until) || r.until < start) throw new Error('Конец повторения должен быть не раньше начала.')
    recurrence.until = r.until
  }
  return recurrence
}

export function expandEvents(events: CalendarEvent[], from: string, to: string): CalendarEvent[] {
  const dayMs = 86400000
  const first = Date.parse(`${from}T00:00:00Z`), last = Date.parse(`${to}T00:00:00Z`)
  const result: CalendarEvent[] = []
  for (const event of events) {
    const r = event.recurrence
    if (!r) {
      if (event.date >= from && event.date <= to) result.push(event)
      continue
    }
    const start = Date.parse(`${event.date}T00:00:00Z`)
    const end = r.until ? Math.min(last, Date.parse(`${r.until}T00:00:00Z`)) : last
    for (let ms = Math.max(first, start); ms <= end; ms += dayMs) {
      const offset = (ms - start) / dayMs
      const occurs = r.type === 'interval' ? offset % r.intervalDays === 0
        : r.type === 'cycle' ? offset % (r.workDays + r.offDays) < r.workDays
        : r.weekdays.includes((new Date(ms).getUTCDay() + 6) % 7)
      if (occurs) result.push({ ...event, startDate: event.date, date: new Date(ms).toISOString().slice(0, 10) })
    }
  }
  return result.sort((a, b) => b.date.localeCompare(a.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id))
}

export function eventRepeatLabel(r: EventRecurrence) {
  if (r.type === 'cycle') return `${r.workDays}/${r.offDays}`
  if (r.type === 'interval') return r.intervalDays === 1 ? 'каждый день' : `каждые ${r.intervalDays} дн.`
  return r.weekdays.map((day) => ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][day]).join(', ')
}
