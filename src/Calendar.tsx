import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, today } from './api'
import './calendar.css'
import './planning.css'

type Recurrence =
  | { type: 'interval'; intervalDays: number }
  | { type: 'weekdays'; weekdays: number[] }
  | null

type Task = {
  id: string
  title: string
  date: string
  startDate?: string
  occurrenceDate?: string
  completed: boolean
  recurrence: Recurrence
  color: TaskColor
}

type CalendarEvent = { id: string; date: string; title: string; time: string; place: string; note: string; reflection: string }
const emptyEvent = (date = today()) => ({ date, title: '', time: '', place: '', note: '', reflection: '' })

type View = 'week' | 'month'
type RepeatMode = 'none' | 'interval' | 'weekdays'
type TaskColor = 'default' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'gray'
const taskColors: { key: TaskColor; label: string }[] = [
  { key: 'default', label: 'Без цвета' },
  { key: 'red', label: 'Красный' },
  { key: 'orange', label: 'Оранжевый' },
  { key: 'yellow', label: 'Жёлтый' },
  { key: 'green', label: 'Зелёный' },
  { key: 'blue', label: 'Синий' },
  { key: 'purple', label: 'Фиолетовый' },
  { key: 'pink', label: 'Розовый' },
  { key: 'gray', label: 'Серый' }
]

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const months = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
]
const monthTitles = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
]

function parseDate(value: string) {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}
function startOfWeek(date: Date) {
  const d = new Date(date)
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return d
}
function endOfWeek(date: Date) {
  return addDays(startOfWeek(date), 6)
}
function monthGrid(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  const start = startOfWeek(first)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}
function rangeFor(view: View, anchor: Date) {
  if (view === 'week') return [startOfWeek(anchor), endOfWeek(anchor)] as const
  const grid = monthGrid(anchor)
  return [grid[0], grid[grid.length - 1]] as const
}
function formatWeekTitle(anchor: Date) {
  const from = startOfWeek(anchor)
  const to = endOfWeek(anchor)
  if (from.getFullYear() !== to.getFullYear())
    return `${from.getDate()} ${months[from.getMonth()]} ${from.getFullYear()} — ${to.getDate()} ${months[to.getMonth()]} ${to.getFullYear()}`
  if (from.getMonth() === to.getMonth())
    return `${from.getDate()}–${to.getDate()} ${months[from.getMonth()]} ${from.getFullYear()}`
  return `${from.getDate()} ${months[from.getMonth()]} — ${to.getDate()} ${months[to.getMonth()]} ${from.getFullYear()}`
}
function repeatLabel(recurrence: Recurrence) {
  if (!recurrence) return ''
  if (recurrence.type === 'interval') {
    return recurrence.intervalDays === 1 ? 'каждый день' : `каждые ${recurrence.intervalDays} дн.`
  }
  return recurrence.weekdays.map((d) => weekdays[d]).join(', ')
}
function recurrencePayload(mode: RepeatMode, intervalDays: number, selected: number[]) {
  if (mode === 'interval') return { type: 'interval', intervalDays }
  if (mode === 'weekdays') return { type: 'weekdays', weekdays: selected }
  return { type: 'none' }
}

const taskIdentity = (task: Task) => `${task.id}:${task.occurrenceDate ?? task.date}`

function ColorPicker({ value, onChange }: { value: TaskColor; onChange: (color: TaskColor) => void }) {
  return (
    <div className="task-color-picker" aria-label="Цвет задачи">
      <span>Цвет</span>
      <div className="task-color-options">
        {taskColors.map((color) => (
          <button
            key={color.key}
            type="button"
            className={`task-color-option color-${color.key} ${value === color.key ? 'active' : ''}`}
            aria-label={color.label}
            title={color.label}
            onClick={() => onChange(color.key)}
          />
        ))}
      </div>
    </div>
  )
}

function RepeatControls({
  mode,
  setMode,
  intervalDays,
  setIntervalDays,
  selected,
  setSelected
}: {
  mode: RepeatMode
  setMode: (mode: RepeatMode) => void
  intervalDays: number
  setIntervalDays: (value: number) => void
  selected: number[]
  setSelected: (value: number[]) => void
}) {
  return (
    <div className="repeat-controls">
      <label className="repeat-label">
        <span>Повторение</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as RepeatMode)}>
          <option value="none">Не повторять</option>
          <option value="interval">Раз в N дней</option>
          <option value="weekdays">По дням недели</option>
        </select>
      </label>
      {mode === 'interval' && (
        <label className="repeat-interval">
          <span>Каждые</span>
          <input
            type="number"
            min={1}
            max={365}
            value={intervalDays}
            onChange={(e) => setIntervalDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
          />
          <span>дн.</span>
        </label>
      )}
      {mode === 'weekdays' && (
        <div className="weekday-picker" aria-label="Дни недели">
          {weekdays.map((day, index) => {
            const active = selected.includes(index)
            return (
              <button
                key={day}
                type="button"
                className={active ? 'active' : ''}
                onClick={() =>
                  setSelected(active ? selected.filter((d) => d !== index) : [...selected, index].sort())
                }
              >
                {day}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Calendar() {
  const [view, setView] = useState<View>('week')
  const [anchor, setAnchor] = useState(() => parseDate(today()))
  const [tasks, setTasks] = useState<Task[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [eventForm, setEventForm] = useState(emptyEvent)
  const [eventEditor, setEventEditor] = useState(false)
  const eventEditorRef = useRef<HTMLFormElement>(null)
  const [eventId, setEventId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addingDate, setAddingDate] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('none')
  const [intervalDays, setIntervalDays] = useState(1)
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>([])
  const [draftColor, setDraftColor] = useState<TaskColor>('default')
  const [editing, setEditing] = useState<Task | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editRepeatMode, setEditRepeatMode] = useState<RepeatMode>('none')
  const [editIntervalDays, setEditIntervalDays] = useState(1)
  const [editWeekdays, setEditWeekdays] = useState<number[]>([])
  const [editColor, setEditColor] = useState<TaskColor>('default')
  const [saving, setSaving] = useState(false)
  const [draggingTask, setDraggingTask] = useState<Task | null>(null)
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)

  const [from, to] = useMemo(() => rangeFor(view, anchor), [view, anchor])
  const days = useMemo(
    () =>
      view === 'week'
        ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))
        : monthGrid(anchor),
    [view, anchor]
  )

  async function loadEvents() {
    setEvents(await api<CalendarEvent[]>(`/api/events?from=${iso(from)}&to=${iso(to)}`))
  }

  async function saveEvent(event: FormEvent) {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      await api(eventId ? `/api/events/${eventId}` : '/api/events', { method: eventId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(eventForm) })
      setEventEditor(false); setEventId(null); setEventForm(emptyEvent())
      await loadEvents()
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }
  async function removeEvent() {
    if (!eventId || !window.confirm('Удалить это событие?')) return
    try { await api(`/api/events/${eventId}`, { method: 'DELETE' }); setEventEditor(false); setEventId(null); await loadEvents() }
    catch (e) { setError((e as Error).message) }
  }
  function openEvent(date: string, entry?: CalendarEvent) {
    setEventId(entry?.id ?? null); setEventForm(entry ? { date: entry.date, title: entry.title, time: entry.time, place: entry.place, note: entry.note, reflection: entry.reflection } : emptyEvent(date)); setEventEditor(true)
    requestAnimationFrame(() => eventEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  async function loadTasks(showLoader = false) {
    if (showLoader) setLoading(true)
    setError('')
    try {
      const rows = await api<Task[]>(`/api/tasks?from=${iso(from)}&to=${iso(to)}`)
      setTasks(rows)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      if (showLoader) setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    Promise.all([api<Task[]>(`/api/tasks?from=${iso(from)}&to=${iso(to)}`), api<CalendarEvent[]>(`/api/events?from=${iso(from)}&to=${iso(to)}`)])
      .then(([rows, entries]) => { if (alive) { setTasks(rows); setEvents(entries) } })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [from.getTime(), to.getTime()])

  const byDate = useMemo(() => {
    const grouped = new Map<string, Task[]>()
    for (const task of tasks) {
      const list = grouped.get(task.date) ?? []
      list.push(task)
      grouped.set(task.date, list)
    }
    return grouped
  }, [tasks])

  function resetAdd() {
    setAddingDate(null)
    setDraft('')
    setRepeatMode('none')
    setIntervalDays(1)
    setRepeatWeekdays([])
    setDraftColor('default')
  }

  function move(direction: -1 | 1) {
    resetAdd()
    setEditing(null)
    setAnchor((current) => {
      const next = new Date(current)
      if (view === 'week') next.setDate(next.getDate() + direction * 7)
      else next.setMonth(next.getMonth() + direction, 1)
      return next
    })
  }

  function goToday() {
    setAnchor(parseDate(today()))
    resetAdd()
    setEditing(null)
  }

  function beginAdd(date: string) {
    setEditing(null)
    setAddingDate(date)
    setDraft('')
    setRepeatMode('none')
    setIntervalDays(1)
    setRepeatWeekdays([(parseDate(date).getDay() + 6) % 7])
    setDraftColor('default')
  }

  async function addTask(event: FormEvent, date: string) {
    event.preventDefault()
    const title = draft.trim()
    if (!title || saving || (repeatMode === 'weekdays' && !repeatWeekdays.length)) return
    setSaving(true)
    setError('')
    try {
      await api<Task>('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          date,
          recurrence: recurrencePayload(repeatMode, intervalDays, repeatWeekdays),
          color: draftColor
        })
      })
      resetAdd()
      await loadTasks()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function toggle(task: Task) {
    const optimistic = { ...task, completed: !task.completed }
    setTasks((current) =>
      current.map((t) => (taskIdentity(t) === taskIdentity(task) ? optimistic : t))
    )
    try {
      const saved = await api<Task>(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: optimistic.completed, date: task.date, occurrenceDate: task.occurrenceDate })
      })
      setTasks((current) =>
        current.map((t) => (taskIdentity(t) === taskIdentity(task) ? saved : t))
      )
    } catch (e) {
      setTasks((current) =>
        current.map((t) => (taskIdentity(t) === taskIdentity(task) ? task : t))
      )
      setError((e as Error).message)
    }
  }

  function beginEdit(task: Task) {
    resetAdd()
    setEditing(task)
    setEditTitle(task.title)
    setEditDate(task.startDate ?? task.date)
    setEditColor(task.color ?? 'default')
    if (!task.recurrence) {
      setEditRepeatMode('none')
      setEditIntervalDays(1)
      setEditWeekdays([(parseDate(task.date).getDay() + 6) % 7])
    } else if (task.recurrence.type === 'interval') {
      setEditRepeatMode('interval')
      setEditIntervalDays(task.recurrence.intervalDays)
      setEditWeekdays([])
    } else {
      setEditRepeatMode('weekdays')
      setEditIntervalDays(1)
      setEditWeekdays(task.recurrence.weekdays)
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault()
    if (!editing || !editTitle.trim() || saving || (editRepeatMode === 'weekdays' && !editWeekdays.length)) return
    setSaving(true)
    setError('')
    try {
      await api<Task>(`/api/tasks/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          date: editDate,
          recurrence: recurrencePayload(editRepeatMode, editIntervalDays, editWeekdays),
          color: editColor
        })
      })
      setEditing(null)
      await loadTasks()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(task: Task) {
    if (task.recurrence && !window.confirm(`Удалить повторяющуюся задачу «${task.title}» целиком? Выполненные задачи останутся в истории.`)) return
    const before = tasks
    setTasks((current) => current.filter((t) => t.id !== task.id))
    if (editing?.id === task.id) setEditing(null)
    try {
      await api<void>(`/api/tasks/${task.id}`, { method: 'DELETE' })
      await loadTasks()
    } catch (e) {
      setTasks(before)
      setError((e as Error).message)
    }
  }

  async function moveTask(task: Task, toDate: string) {
    if (task.date === toDate || saving) return
    const before = tasks
    const identity = taskIdentity(task)
    const optimistic = { ...task, date: toDate }
    setTasks((current) => current.map((item) => taskIdentity(item) === identity ? optimistic : item))
    setError('')
    try {
      const saved = await api<Task>(`/api/tasks/${task.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromDate: task.occurrenceDate ?? task.date, toDate })
      })
      setTasks((current) => current.map((item) => taskIdentity(item) === taskIdentity(optimistic) ? saved : item))
    } catch (e) {
      setTasks(before)
      setError((e as Error).message)
    }
  }

  const title =
    view === 'week'
      ? formatWeekTitle(anchor)
      : `${monthTitles[anchor.getMonth()]} ${anchor.getFullYear()}`

  return (
    <main className="calendar-page">
      <header className="calendar-header">
        <div>
          <div className="eyebrow">ПЛАНИРОВАНИЕ</div>
          <h1>Календарь</h1>
          <p className="muted">Задачи на неделю и месяц. Разовые и повторяющиеся.</p>
        </div>
        <button className="secondary" onClick={() => openEvent(today())}>+ Событие</button>
        <div className="calendar-view-switch" aria-label="Вид календаря">
          <button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>Неделя</button>
          <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>Месяц</button>
        </div>
      </header>

      {error && <div className="message error">{error}</div>}
      {eventEditor && <form className="card calendar-event-form" ref={eventEditorRef} onSubmit={(e) => void saveEvent(e)}>
        <h2>{eventId ? 'Изменить событие' : 'Новое событие'}</h2>
        <div className="planning-fields"><label>Название<input required maxLength={200} value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} /></label><label>Дата<input required type="date" value={eventForm.date} onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })} /></label><label>Время<input type="time" value={eventForm.time} onChange={(e) => setEventForm({ ...eventForm, time: e.target.value })} /></label><label>Место<input maxLength={200} value={eventForm.place} onChange={(e) => setEventForm({ ...eventForm, place: e.target.value })} /></label></div>
        <label>Подготовка или заметка<textarea maxLength={5000} value={eventForm.note} onChange={(e) => setEventForm({ ...eventForm, note: e.target.value })} /></label>
        <label>Что осталось после события<textarea maxLength={5000} value={eventForm.reflection} onChange={(e) => setEventForm({ ...eventForm, reflection: e.target.value })} /></label>
        <div className="form-actions"><button disabled={saving}>Сохранить</button><button type="button" className="secondary" onClick={() => setEventEditor(false)}>Отмена</button>{eventId && <button type="button" className="secondary" onClick={() => void removeEvent()}>Удалить</button>}</div>
      </form>}

      <section className="calendar-toolbar" aria-label="Навигация календаря">
        <div className="calendar-nav">
          <button className="secondary calendar-arrow" onClick={() => move(-1)} aria-label="Назад">←</button>
          <button className="secondary" onClick={goToday}>Сегодня</button>
          <button className="secondary calendar-arrow" onClick={() => move(1)} aria-label="Вперёд">→</button>
        </div>
        <strong className="calendar-range-title">{title}</strong>
        <div className="calendar-summary">
          {tasks.filter((task) => task.completed).length}/{tasks.length} выполнено
        </div>
      </section>

      {loading ? (
        <div className="calendar-loading">Загружаю задачи…</div>
      ) : (
        <section className={`calendar-grid ${view}`}>
          {view === 'month' && weekdays.map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}
          {days.map((day, index) => {
            const date = iso(day)
            const items = byDate.get(date) ?? []
            const isToday = date === today()
            const otherMonth = view === 'month' && day.getMonth() !== anchor.getMonth()
            return (
              <article
                className={`calendar-day ${isToday ? 'today' : ''} ${otherMonth ? 'other-month' : ''} ${dragOverDate === date && draggingTask?.date !== date ? 'drag-over' : ''}`}
                key={date}
                onDragEnter={() => draggingTask && setDragOverDate(date)}
                onDragOver={(event) => {
                  if (!draggingTask) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const task = draggingTask
                  setDraggingTask(null)
                  setDragOverDate(null)
                  if (task) void moveTask(task, date)
                }}
              >
                <div className="calendar-day-head">
                  <div>
                    {view === 'week' && <span className="calendar-day-weekday">{weekdays[index]}</span>}
                    <strong className="calendar-day-number">{day.getDate()}</strong>
                    {view === 'week' && <span className="calendar-day-month">{months[day.getMonth()]}</span>}
                  </div>
                  {isToday && <span className="today-chip">сегодня</span>}
                </div>

                <div className="calendar-events">{events.filter((entry) => entry.date === date).sort((a, b) => a.time.localeCompare(b.time)).map((entry) => <button key={entry.id} className="calendar-event" onClick={() => openEvent(date, entry)} title={[entry.place, entry.note, entry.reflection].filter(Boolean).join(" · ")}><strong>{entry.time || "◷"} {entry.title}</strong>{entry.place && <small>{entry.place}</small>}{entry.reflection && <small>Есть заметка после ↗</small>}</button>)}</div>
                <div className="task-list">
                  {items.map((task) => {
                    const isEditing = editing ? taskIdentity(editing) === taskIdentity(task) : false
                    return isEditing ? (
                      <form className="task-edit-form" onSubmit={saveEdit} key={taskIdentity(task)}>
                        <input autoFocus value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={200} />
                        <label className="edit-date-label">
                          <span>Начало</span>
                          <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                        </label>
                        <ColorPicker value={editColor} onChange={setEditColor} />
                        <RepeatControls
                          mode={editRepeatMode}
                          setMode={setEditRepeatMode}
                          intervalDays={editIntervalDays}
                          setIntervalDays={setEditIntervalDays}
                          selected={editWeekdays}
                          setSelected={setEditWeekdays}
                        />
                        <div className="task-form-actions">
                          <button type="submit" disabled={!editTitle.trim() || saving || (editRepeatMode === 'weekdays' && !editWeekdays.length)}>Сохранить</button>
                          <button type="button" className="secondary" onClick={() => setEditing(null)}>Отмена</button>
                        </div>
                        {task.recurrence && (
                          <button type="button" className="danger-link" onClick={() => remove(task)}>Удалить всю повторяющуюся задачу</button>
                        )}
                      </form>
                    ) : (
                      <div
                        className={`task-row color-${task.color ?? 'default'} ${task.completed ? 'done' : ''} ${draggingTask && taskIdentity(draggingTask) === taskIdentity(task) ? 'dragging' : ''}`}
                        key={taskIdentity(task)}
                        draggable={!saving}
                        title="Перетащи задачу на другой день"
                        onDragStart={(event) => {
                          setDraggingTask(task)
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', taskIdentity(task))
                        }}
                        onDragEnd={() => {
                          setDraggingTask(null)
                          setDragOverDate(null)
                        }}
                      >
                        <label className="task-check-label" title={task.completed ? 'Вернуть задачу' : 'Выполнить'}>
                          <input className="task-checkbox" type="checkbox" checked={task.completed} onChange={() => toggle(task)} />
                          <span className="task-fake-check" aria-hidden="true" />
                          <span className="task-copy">
                            <span className="task-title">{task.title}</span>
                            {task.recurrence && <span className="task-repeat-badge" title="Повторяющаяся задача">↻ {repeatLabel(task.recurrence)}</span>}
                          </span>
                        </label>
                        <div className="task-actions">
                          <button className="task-edit" onClick={() => beginEdit(task)} aria-label={`Редактировать задачу «${task.title}»`} title="Редактировать">✎</button>
                          <button className="task-delete" onClick={() => remove(task)} aria-label={`Удалить задачу «${task.title}»`} title={task.recurrence ? 'Удалить всё повторение' : 'Удалить'}>×</button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {addingDate === date ? (
                  <form className="task-form" onSubmit={(event) => addTask(event, date)}>
                    <input
                      autoFocus
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Новая задача…"
                      maxLength={200}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') resetAdd()
                      }}
                    />
                    <ColorPicker value={draftColor} onChange={setDraftColor} />
                    <RepeatControls
                      mode={repeatMode}
                      setMode={setRepeatMode}
                      intervalDays={intervalDays}
                      setIntervalDays={setIntervalDays}
                      selected={repeatWeekdays}
                      setSelected={setRepeatWeekdays}
                    />
                    <div className="task-form-actions">
                      <button type="submit" disabled={!draft.trim() || saving || (repeatMode === 'weekdays' && !repeatWeekdays.length)}>Добавить</button>
                      <button type="button" className="secondary" onClick={resetAdd}>Отмена</button>
                    </div>
                  </form>
                ) : (
                  <div className="calendar-add-actions"><button className="add-task-button" onClick={() => beginAdd(date)}><span>＋</span> Задача</button><button className="add-task-button" onClick={() => openEvent(date)}>＋ Событие</button></div>
                )}
              </article>
            )
          })}
        </section>
      )}
    </main>
  )
}
