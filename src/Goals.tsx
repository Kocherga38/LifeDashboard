import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, today } from './api'
import type { PersonalGoal } from './goalTypes'
import { goalDeadline, visibleGoals } from './goalTypes'
import MonthlyGoals from './MonthlyGoals'

type FormState = { title: string; description: string; nextStep: string; dueDate: string; pinned: boolean }
const emptyForm = (): FormState => ({ title: '', description: '', nextStep: '', dueDate: '', pinned: true })

export default function Goals({ initialMonth }: { initialMonth: string }) {
  const [items, setItems] = useState<PersonalGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<PersonalGoal | null>(null)
  const [busy, setBusy] = useState(false)
  const [monthlyRefresh, setMonthlyRefresh] = useState(0)
  const editor = useRef<HTMLElement>(null)

  useEffect(() => {
    let alive = true
    api<PersonalGoal[]>('/api/personal-goals')
      .then((goals) => { if (alive) setItems(goals) })
      .catch((e) => { if (alive) setError((e as Error).message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  function openEditor(goal: PersonalGoal | null = null) {
    setEditing(goal)
    setForm(goal ? {
      title: goal.title, description: goal.description, nextStep: goal.nextStep,
      dueDate: goal.dueDate ?? '', pinned: goal.pinned
    } : emptyForm())
    setError('')
    setEditorOpen(true)
    requestAnimationFrame(() => editor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function closeEditor() {
    setEditorOpen(false)
    setEditing(null)
    setForm(emptyForm())
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const saved = await api<PersonalGoal>(editing ? `/api/personal-goals/${editing.id}` : '/api/personal-goals', {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, dueDate: form.dueDate || null, status: editing?.status ?? 'active' })
      })
      setItems((current) => editing ? current.map((goal) => goal.id === saved.id ? saved : goal) : [...current, saved])
      closeEditor()
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  async function update(goal: PersonalGoal, changes: Partial<PersonalGoal>) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const saved = await api<PersonalGoal>(`/api/personal-goals/${goal.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...goal, ...changes })
      })
      setItems((current) => current.map((item) => item.id === saved.id ? saved : item))
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  async function remove(goal: PersonalGoal) {
    if (busy || !window.confirm(`Удалить цель «${goal.title}» вместе с её подцелями по месяцам?`)) return
    setBusy(true); setError('')
    try {
      await api<void>(`/api/personal-goals/${goal.id}`, { method: 'DELETE' })
      setItems((current) => current.filter((item) => item.id !== goal.id))
      setMonthlyRefresh((value) => value + 1)
      if (editing?.id === goal.id) closeEditor()
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const active = items.filter((goal) => goal.status === 'active')
  const inactive = items.filter((goal) => goal.status !== 'active')
  const pinned = visibleGoals(items).length
  const renderGoal = (goal: PersonalGoal) => <article className={`card goal-card ${goal.status !== 'active' ? 'goal-card-inactive' : ''}`} key={goal.id}>
    <div className="goal-card-top"><span className={`goal-status goal-status-${goal.status}`}><span />{goal.status === 'active' ? 'В РАБОТЕ' : goal.status === 'paused' ? 'ПАУЗА' : 'ЗАВЕРШЕНА'}</span>
      <button className={`goal-pin ${goal.pinned ? 'on' : ''}`} title={goal.pinned ? 'Убрать из сводок' : 'Показывать в сводках'} aria-label={goal.pinned ? `Убрать «${goal.title}» из сводок` : `Показывать «${goal.title}» в сводках`} disabled={busy} onClick={() => void update(goal, { pinned: !goal.pinned })}>{goal.pinned ? '◉ В сводках' : '◎ Не в сводках'}</button>
    </div>
    <h2>{goal.title}</h2>
    {goal.description && <p className="goal-description">{goal.description}</p>}
    <div className="goal-card-meta"><span className={goal.dueDate && goal.dueDate < today() && goal.status === 'active' ? 'overdue' : ''}>◷ {goalDeadline(goal.dueDate, today())}</span></div>
    {goal.nextStep && <div className="goal-next"><span>СЛЕДУЮЩИЙ ШАГ</span><p>{goal.nextStep}</p></div>}
    <div className="goal-card-actions">
      <button className="secondary" onClick={() => openEditor(goal)}>Изменить</button>
      {goal.status === 'active' ? <><button className="secondary" disabled={busy} onClick={() => void update(goal, { status: 'paused' })}>Пауза</button><button className="secondary" disabled={busy} onClick={() => void update(goal, { status: 'completed', pinned: false })}>Завершить</button></> : <button className="secondary" disabled={busy} onClick={() => void update(goal, { status: 'active', pinned: true })}>Вернуть в работу</button>}
      <button className="goal-delete" disabled={busy} onClick={() => void remove(goal)} aria-label={`Удалить «${goal.title}»`}>Удалить</button>
    </div>
  </article>

  return <main className="goals-page">
    <header><div><div className="eyebrow">ТРЕКТОРИЯ / TRELLIS</div><h1>Цели</h1><p className="muted">То, к чему ты возвращаешься каждый день. Держи главное перед глазами и уточняй путь по ходу.</p></div><button onClick={() => openEditor()}>+ Новая цель</button></header>
    {error && <p className="message error" role="alert">{error}</p>}
    {editorOpen && <section className="card goal-editor" ref={editor}>
      <div className="section-heading"><div><span className="kicker">{editing ? 'РЕДАКТИРОВАНИЕ' : 'НОВАЯ ЦЕЛЬ'}</span><h2>{editing ? 'Уточнить цель' : 'Что хочешь сделать?'}</h2></div><button className="icon-button" aria-label="Закрыть" onClick={closeEditor}>×</button></div>
      <form onSubmit={(e) => void submit(e)}>
        <label>Название<input autoFocus required maxLength={160} placeholder="Например, набрать 70 кг" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label>Описание <span className="goal-field-hint">Зачем тебе это и что будет считаться результатом</span><textarea maxLength={4000} rows={3} placeholder="Опиши цель своими словами" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <div className="goal-form-row"><label>Дата, если есть<input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label><label>Следующий шаг <span className="goal-field-hint">Можно добавить позже</span><input maxLength={300} placeholder="Что сделаешь дальше?" value={form.nextStep} onChange={(e) => setForm({ ...form, nextStep: e.target.value })} /></label></div>
        <label className="goal-pin-control"><input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} /><span><strong>Показывать в сводках</strong><small>Цель появится на экранах «Сегодня» и «Обзор недели».</small></span></label>
        <div className="form-actions"><button disabled={busy}>{busy ? 'Сохраняю…' : editing ? 'Сохранить изменения' : 'Создать цель'}</button><button type="button" className="secondary" onClick={closeEditor}>Отмена</button></div>
      </form>
    </section>}
    <div className="goal-page-summary"><span><strong>{active.length}</strong> в работе</span><span><strong>{pinned}</strong> перед глазами</span><span><strong>{inactive.filter((goal) => goal.status === 'completed').length}</strong> завершено</span></div>
    {loading ? <p className="muted">Загружаю цели…</p> : <>
      <MonthlyGoals parents={items} refreshKey={monthlyRefresh} initialMonth={initialMonth} />
      <div className="goal-archive-heading"><span className="eyebrow">ДАЛЬНИЙ ГОРИЗОНТ</span><h2>Большие цели</h2></div>
      {active.length ? <section className="goal-list" aria-label="Активные цели">{active.map(renderGoal)}</section> : <div className="card goal-empty"><span aria-hidden="true">✳</span><h2>Место для того, что важно</h2><p>Начни с одной цели. Названия и пары строк достаточно — план можно уточнить позже.</p><button onClick={() => openEditor()}>Создать первую цель →</button></div>}
      {inactive.length > 0 && <section className="goal-archive"><div className="goal-archive-heading"><span className="eyebrow">ИСТОРИЯ</span><h2>На паузе и завершённые</h2></div><div className="goal-list">{inactive.map(renderGoal)}</div></section>}
    </>}
  </main>
}
