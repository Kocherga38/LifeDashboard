import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import './personal.css'

type Habit = { id: string; name: string; createdAt: string }
type Mark = { habitId: string; date: string }
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function Habits() {
  const [habits, setHabits] = useState<Habit[]>([])
  const [marks, setMarks] = useState<Mark[]>([])
  const [cursor, setCursor] = useState(() => new Date())
  const [error, setError] = useState('')
  const [savingOrder, setSavingOrder] = useState(false)
  const [draggedHabit, setDraggedHabit] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const y = cursor.getFullYear(), m = cursor.getMonth(), days = new Date(y, m + 1, 0).getDate()
  const from = iso(new Date(y, m, 1)), to = iso(new Date(y, m, days))
  const load = async () => {
    const [h, x] = await Promise.all([api<Habit[]>('/api/habits'), api<Mark[]>(`/api/habit-marks?from=${from}&to=${to}`)])
    setHabits(h); setMarks(x)
  }
  useEffect(() => { load().catch((e) => setError(e.message)) }, [from, to])
  const set = useMemo(() => new Set(marks.map((x) => `${x.habitId}:${x.date}`)), [marks])
  const add = async () => {
    const name = prompt('Что отслеживаем? Например: тренировка, чтение, срал')?.trim()
    if (!name) return
    await api('/api/habits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    await load()
  }
  const rename = async (h: Habit) => {
    const name = prompt('Новое название действия', h.name)?.trim()
    if (!name) return
    await api(`/api/habits/${h.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    await load()
  }
  const remove = async (h: Habit) => {
    if (!confirm(`Удалить трекер «${h.name}» и всю его историю?`)) return
    await api(`/api/habits/${h.id}`, { method: 'DELETE' })
    await load()
  }
  const toggle = async (h: Habit, date: string) => {
    await api(`/api/habits/${h.id}/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }) })
    await load()
  }
  const reorder = async (sourceId: string, targetId: string) => {
    if (savingOrder || sourceId === targetId) return
    const before = habits
    const fromIndex = before.findIndex((habit) => habit.id === sourceId)
    const targetIndex = before.findIndex((habit) => habit.id === targetId)
    if (fromIndex < 0 || targetIndex < 0) return
    const next = [...before]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(targetIndex, 0, moved)
    setHabits(next)
    setSavingOrder(true)
    setError('')
    try {
      await api('/api/habits/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: next.map((habit) => habit.id) })
      })
    } catch (error) {
      setHabits(before)
      setError('Не удалось сохранить порядок трекеров: ' + (error as Error).message)
    } finally {
      setSavingOrder(false)
    }
  }
  const shift = (n: number) => setCursor(new Date(y, m + n, 1))
  return <main>
    <header><div><div className="eyebrow">ACTION TRACKER</div><h1>Трекер</h1><p className="muted">Создавай любое действие и отмечай даты. Без навязанного смысла: спорт, таблетки, чтение или хоть поход в туалет. Меняй порядок строк перетаскиванием или стрелками.</p></div><button onClick={add}>+ Трекер</button></header>
    {error && <div className="message error">{error}</div>}
    <section className="card habit-card">
      <div className="habit-toolbar"><button className="secondary" onClick={() => shift(-1)}>←</button><h2>{cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</h2><button className="secondary" onClick={() => shift(1)}>→</button><button className="secondary" onClick={() => setCursor(new Date())}>Сегодня</button></div>
      <div className="habit-scroll">
        <table className="habit-table">
          <thead>
            <tr>
              <th className="habit-name">Действие</th>
              {Array.from({ length: days }, (_, i) => (
                <th key={i}>{i + 1}<small>{['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][new Date(y, m, i + 1).getDay()]}</small></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {habits.map((h, index) => (
              <tr
                key={h.id}
                className={(draggedHabit === h.id ? 'habit-dragging ' : '') + (dropTarget === h.id ? 'habit-drop-target' : '')}
                onDragOver={(event) => {
                  if (!savingOrder && draggedHabit && draggedHabit !== h.id) {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDropTarget(h.id)
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const source = draggedHabit
                  setDraggedHabit(null)
                  setDropTarget(null)
                  if (source) void reorder(source, h.id)
                }}
              >
                <td className="habit-name">
                  <div className="habit-name-row">
                    <span
                      className="habit-drag-handle"
                      draggable={!savingOrder}
                      title="Перетащи, чтобы изменить порядок"
                      aria-hidden="true"
                      onDragStart={(event) => {
                        setDraggedHabit(h.id)
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', h.id)
                      }}
                      onDragEnd={() => { setDraggedHabit(null); setDropTarget(null) }}
                    >⋮⋮</span>
                    <strong>{h.name}</strong>
                    <span className="habit-actions">
                      <button type="button" className="icon-button habit-order-button" disabled={savingOrder || index === 0} aria-label={'Поднять «' + h.name + '»'} title="Выше" onClick={() => void reorder(h.id, habits[index - 1].id)}>↑</button>
                      <button type="button" className="icon-button habit-order-button" disabled={savingOrder || index === habits.length - 1} aria-label={'Опустить «' + h.name + '»'} title="Ниже" onClick={() => void reorder(h.id, habits[index + 1].id)}>↓</button>
                      <button type="button" className="icon-button" aria-label={'Переименовать «' + h.name + '»'} title="Переименовать" onClick={() => rename(h)}>✎</button>
                      <button type="button" className="icon-button delete" aria-label={'Удалить «' + h.name + '»'} title="Удалить" onClick={() => remove(h)}>×</button>
                    </span>
                  </div>
                </td>
                {Array.from({ length: days }, (_, i) => {
                  const date = iso(new Date(y, m, i + 1))
                  const on = set.has(h.id + ':' + date)
                  return <td key={date}><button aria-label={h.name + ' ' + date} className={'habit-dot ' + (on ? 'done' : '')} onClick={() => toggle(h, date)}>{on ? '✓' : ''}</button></td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!habits.length && <p className="muted empty">Создай первый трекер — потом просто кликай по дням.</p>}
    </section>
  </main>
}
