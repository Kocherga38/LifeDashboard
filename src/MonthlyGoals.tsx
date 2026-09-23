import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, today } from './api'
import type { MonthlyGoal, PersonalGoal } from './goalTypes'
import { monthLabel, shiftMonth } from './goalTypes'

type FormState = { parentId: string; month: string; title: string; description: string; nextStep: string }

export default function MonthlyGoals({ parents, refreshKey, initialMonth }: { parents: PersonalGoal[]; refreshKey: number; initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth)
  const [items, setItems] = useState<MonthlyGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<MonthlyGoal | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const activeParents = parents.filter((goal) => goal.status === 'active')

  useEffect(() => {
    let alive = true
    setLoading(true)
    api<MonthlyGoal[]>(`/api/monthly-goals?month=${month}`)
      .then((goals) => { if (alive) { setItems(goals); setError('') } })
      .catch((e) => { if (alive) setError((e as Error).message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [month, refreshKey])

  const reload = async () => setItems(await api<MonthlyGoal[]>(`/api/monthly-goals?month=${month}`))
  const open = (goal?: MonthlyGoal) => {
    setEditing(goal ?? null)
    setForm(goal ? { parentId: goal.parentId, month: goal.month, title: goal.title, description: goal.description, nextStep: goal.nextStep }
      : { parentId: activeParents[0]?.id ?? '', month, title: '', description: '', nextStep: '' })
    setError('')
  }
  const close = () => { setForm(null); setEditing(null) }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form || busy) return
    setBusy(true); setError('')
    try {
      await api(editing ? `/api/monthly-goals/${editing.id}` : '/api/monthly-goals', {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, completed: editing?.completed ?? false })
      })
      close()
      await reload()
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const toggle = async (goal: MonthlyGoal) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      await api(`/api/monthly-goals/${goal.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...goal, completed: !goal.completed })
      })
      await reload()
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const remove = async (goal: MonthlyGoal) => {
    if (busy || !window.confirm(`Удалить подцель «${goal.title}»?`)) return
    setBusy(true); setError('')
    try {
      await api<void>(`/api/monthly-goals/${goal.id}`, { method: 'DELETE' })
      if (editing?.id === goal.id) close()
      await reload()
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  return <section className="monthly-goals" aria-labelledby="monthly-goals-title">
    <div className="monthly-goals-heading">
      <div><span className="eyebrow">БЛИЖАЙШИЙ ГОРИЗОНТ</span><h2 id="monthly-goals-title">Цели на {monthLabel(month)}</h2><p>Конкретный результат на месяц, который приближает большую цель.</p></div>
      <div className="monthly-goals-controls">
        <button className="secondary" aria-label="Предыдущий месяц" onClick={() => { close(); setMonth(shiftMonth(month, -1)) }}>←</button>
        <button className="secondary" onClick={() => { close(); setMonth(today().slice(0, 7)) }}>Этот месяц</button>
        <button className="secondary" aria-label="Следующий месяц" onClick={() => { close(); setMonth(shiftMonth(month, 1)) }}>→</button>
        <button disabled={!activeParents.length} onClick={() => open()}>+ Подцель</button>
      </div>
    </div>
    {error && <p className="message error" role="alert">{error}</p>}
    {form && <form className="card monthly-goal-editor" onSubmit={(e) => void submit(e)}>
      <div className="section-heading"><div><span className="kicker">{editing ? 'РЕДАКТИРОВАНИЕ' : 'ПЛАН НА МЕСЯЦ'}</span><h2>{editing ? 'Уточнить подцель' : 'Какой результат хочешь получить?'}</h2></div><button type="button" className="icon-button" onClick={close} aria-label="Закрыть">×</button></div>
      <div className="monthly-form-row">
        <label>Месяц<input type="month" required value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} /></label>
        <label>Большая цель<select required value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
          {parents.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
        </select></label>
      </div>
      <label>Результат месяца<input autoFocus required maxLength={160} placeholder="Например, провести 8 тренировок" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
      <label>Описание <span className="goal-field-hint">Необязательно</span><textarea maxLength={4000} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Как поймёшь, что получилось?" /></label>
      <label>Следующий шаг <span className="goal-field-hint">Необязательно</span><input maxLength={300} value={form.nextStep} onChange={(e) => setForm({ ...form, nextStep: e.target.value })} placeholder="С чего начнёшь?" /></label>
      <div className="form-actions"><button disabled={busy}>{busy ? 'Сохраняю…' : editing ? 'Сохранить' : 'Добавить в месяц'}</button><button type="button" className="secondary" onClick={close}>Отмена</button></div>
    </form>}
    {loading ? <p className="muted">Загружаю план месяца…</p> : items.length ? <div className="monthly-goals-list">
      {items.map((goal) => <article className={`monthly-goal-card ${goal.completed ? 'is-complete' : ''}`} key={goal.id}>
        <button className="monthly-goal-check" disabled={busy} aria-label={goal.completed ? `Вернуть «${goal.title}» в работу` : `Завершить «${goal.title}»`} aria-pressed={goal.completed} onClick={() => void toggle(goal)}>{goal.completed ? '✓' : ''}</button>
        <div className="monthly-goal-body"><span className="monthly-goal-parent">↗ {parents.find((parent) => parent.id === goal.parentId)?.title ?? 'Большая цель'}</span><h3>{goal.title}</h3>{goal.description && <p>{goal.description}</p>}{goal.nextStep && !goal.completed && <small>Дальше: {goal.nextStep}</small>}</div>
        <div className="monthly-goal-actions"><button className="link-button" onClick={() => open(goal)}>Изменить</button><button className="goal-delete" disabled={busy} onClick={() => void remove(goal)}>Удалить</button></div>
      </article>)}
    </div> : <div className="monthly-goals-empty"><span>Пока нет подцелей на этот месяц.</span>{activeParents.length ? <button className="link-button" onClick={() => open()}>Наметить результат →</button> : <span>Сначала создай большую цель ниже.</span>}</div>}
    {!!items.length && <p className="monthly-goals-progress">{items.filter((goal) => goal.completed).length} из {items.length} результатов месяца достигнуто</p>}
  </section>
}
