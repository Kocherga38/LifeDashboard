import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, today } from './api'
import { eventRepeatLabel } from '../shared/events'
import type { EventRecurrence } from '../shared/events'

type RoutineItem = {
  id: string
  date: string
  startDate?: string
  title: string
  time: string
  recurrence: EventRecurrence | null
}

function shiftDate(date: string, offset: number) {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + offset))
  return shifted.toISOString().slice(0, 10)
}

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export default function DailyRoutine() {
  const [date, setDate] = useState(today)
  const [items, setItems] = useState<RoutineItem[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('09:00')
  const [startDate, setStartDate] = useState(today)
  const [mode, setMode] = useState<'none' | 'interval' | 'weekdays'>('none')
  const [intervalDays, setIntervalDays] = useState(1)
  const [selectedDays, setSelectedDays] = useState<number[]>([])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    api<RoutineItem[]>(`/api/daily-routine?date=${date}`)
      .then((rows) => { if (active) setItems(rows) })
      .catch((e: Error) => { if (active) setError(e.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [date])

  async function reload() {
    setItems(await api<RoutineItem[]>(`/api/daily-routine?date=${date}`))
  }
  function reset() {
    setEditing(false)
    setEditingId(null)
    setTitle('')
    setTime('09:00')
    setStartDate(date)
    setMode('none')
    setIntervalDays(1)
    setSelectedDays([])
  }
  function begin(item?: RoutineItem) {
    setError('')
    setEditing(true)
    setEditingId(item?.id ?? null)
    setTitle(item?.title ?? '')
    setTime(item?.time ?? '09:00')
    setStartDate(item?.startDate ?? item?.date ?? date)
    setMode(item?.recurrence?.type === 'interval' ? 'interval' : item?.recurrence?.type === 'weekdays' ? 'weekdays' : 'none')
    setIntervalDays(item?.recurrence?.type === 'interval' ? item.recurrence.intervalDays : 1)
    setSelectedDays(item?.recurrence?.type === 'weekdays' ? item.recurrence.weekdays : [])
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || !title.trim() || (mode === 'weekdays' && !selectedDays.length)) return
    const recurrence: EventRecurrence | null = mode === 'interval' ? { type: 'interval', intervalDays }
      : mode === 'weekdays' ? { type: 'weekdays', weekdays: selectedDays } : null
    setBusy(true)
    setError('')
    try {
      await api(editingId ? `/api/daily-routine/${editingId}` : '/api/daily-routine', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: startDate, title: title.trim(), time, recurrence })
      })
      await reload()
      reset()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function remove(item: RoutineItem) {
    if (busy || !window.confirm(item.recurrence ? 'Удалить всю серию повторяющихся пунктов?' : 'Удалить пункт распорядка?')) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/daily-routine/${item.id}`, { method: 'DELETE' })
      await reload()
      if (editingId === item.id) reset()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="routine">
      <div className="routine-navigation">
        <button className="secondary" aria-label="Предыдущий день" onClick={() => setDate((value) => shiftDate(value, -1))}>←</button>
        <input aria-label="Дата распорядка" type="date" value={date} onChange={(e) => { if (e.target.value) setDate(e.target.value) }} />
        <button className="secondary" aria-label="Следующий день" onClick={() => setDate((value) => shiftDate(value, 1))}>→</button>
        <button className="secondary" onClick={() => setDate(today())}>Сегодня</button>
      </div>
      <p className="muted">Примерный план на день. Время начала без обязательной длительности.</p>
      {error && <div className="message error" role="alert">{error}</div>}
      {loading ? <p className="muted">Загружаю распорядок…</p> : (
        <div className="routine-items">
          {!items.length && <p className="muted">На этот день ничего не запланировано.</p>}
          {items.map((item) => <div key={item.id} className="routine-item">
            <time>{item.time}</time>
            <div className="routine-item-content">
              <span>{item.title}</span>
              {item.recurrence && <small className="task-repeat-badge">↻ {eventRepeatLabel(item.recurrence)}</small>}
            </div>
            <button className="secondary" aria-label={`Изменить: ${item.title}`} disabled={busy} onClick={() => begin(item)}>✎</button>
            <button className="secondary" aria-label={`Удалить: ${item.title}`} disabled={busy} onClick={() => void remove(item)}>×</button>
          </div>)}
        </div>
      )}
      {!editing && <button className="secondary routine-add" onClick={() => begin()}>＋ Добавить пункт</button>}
      {editing && <form className="card routine-form" onSubmit={(e) => void save(e)}>
        <h2>{editingId ? 'Изменить пункт' : 'Новый пункт'}</h2>
        <label>Название<input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, японская грамматика" /></label>
        <div className="planning-fields">
          <label>Время начала<input required type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          <label>{mode === 'none' ? 'Дата' : 'Дата начала повторения'}<input required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
        </div>
        <label>Повторение<select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="none">Не повторять</option>
          <option value="interval">Раз в N дней</option>
          <option value="weekdays">По дням недели</option>
        </select></label>
        {mode === 'interval' && <label>Каждые N дней<input type="number" min={1} max={365} value={intervalDays}
          onChange={(e) => setIntervalDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} /></label>}
        {mode === 'weekdays' && <div className="weekday-picker" aria-label="Дни повторения">
          {weekdays.map((name, i) => <button type="button" key={name} className={selectedDays.includes(i) ? 'active' : ''}
            aria-pressed={selectedDays.includes(i)}
            onClick={() => setSelectedDays((days) => days.includes(i) ? days.filter((day) => day !== i) : [...days, i].sort())}>{name}</button>)}
        </div>}
        {editingId && items.find((item) => item.id === editingId)?.recurrence && <small className="muted">Редактирование изменит всю серию.</small>}
        <div className="form-actions">
          <button disabled={busy || !title.trim() || (mode === 'weekdays' && !selectedDays.length)}>Сохранить</button>
          <button type="button" className="secondary" disabled={busy} onClick={reset}>Отмена</button>
        </div>
      </form>}
    </section>
  )
}
