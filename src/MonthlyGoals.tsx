import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { api, today } from './api'
import type { MonthlyGoal, PersonalGoal } from './goalTypes'
import { monthLabel, shiftMonth, monthlyGoalRows, monthlyGoalDescendants } from './goalTypes'

type FormState = { parentId: string; parentSubgoalId: string | null; month: string; title: string; description: string; nextStep: string }

export default function MonthlyGoals({ parents, refreshKey, initialMonth }: { parents: PersonalGoal[]; refreshKey: number; initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth)
  const [items, setItems] = useState<MonthlyGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<MonthlyGoal | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [formItems, setFormItems] = useState<MonthlyGoal[]>([])
  const [formLoading, setFormLoading] = useState(false)
  const activeParents = parents.filter((goal) => goal.status === 'active')
  const [savedOrders, setSavedOrders] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('trellis-monthly-goal-order') || '{}') as Record<string, string[]> }
    catch { return {} }
  })
  const orderedItems = useMemo(() => {
    const positions = new Map((savedOrders[month] ?? []).map((id, index) => [id, index]))
    return [...items].sort((a, b) => (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER))
  }, [items, savedOrders, month])
  const rows = monthlyGoalRows(orderedItems)
  const progressFor = (id: string) => {
    const descendants = monthlyGoalDescendants(items, id)
    const leaves = items.filter((child) => descendants.has(child.id) && !items.some((other) => other.parentSubgoalId === child.id))
    const parent = items.find((goal) => goal.id === id)
    const target = parent?.title.match(/\b(\d+)\s*(?:смен(?:у|ы)?|задач(?:у|и)?|раз(?:а)?|трениров(?:ку|ки|ок))/i)
    const total = Math.max(target ? Number(target[1]) : leaves.length, 1)
    return { complete: leaves.filter((child) => child.completed).length, total, hasChildren: descendants.size > 0 }
  }
  const moveGoal = (goal: MonthlyGoal, direction: -1 | 1) => {
    const siblings = rows.filter(({ goal: other }) => other.parentId === goal.parentId && other.parentSubgoalId === goal.parentSubgoalId).map(({ goal: other }) => other.id)
    const position = siblings.indexOf(goal.id)
    const next = position + direction
    if (next < 0 || next >= siblings.length) return
    const positions = new Map(rows.map(({ goal: row }, index) => [row.id, index]))
    const peer = siblings[next]
    const oldRank = positions.get(goal.id)!
    positions.set(goal.id, positions.get(peer)!)
    positions.set(peer, oldRank)
    const rearranged = [...orderedItems].sort((a, b) => positions.get(a.id)! - positions.get(b.id)!)
    const nextOrders = { ...savedOrders, [month]: monthlyGoalRows(rearranged).map(({ goal: row }) => row.id) }
    setSavedOrders(nextOrders)
    localStorage.setItem('trellis-monthly-goal-order', JSON.stringify(nextOrders))
  }
  const candidates = form?.month === month ? items : formItems
  const excluded = editing ? monthlyGoalDescendants(candidates, editing.id) : new Set<string>()
  const parentOptions = monthlyGoalRows(candidates).filter(({ goal }) =>
    goal.parentId === form?.parentId && goal.id !== editing?.id && !excluded.has(goal.id))

  useEffect(() => {
    let alive = true
    setLoading(true)
    api<MonthlyGoal[]>(`/api/monthly-goals?month=${month}`)
      .then((goals) => { if (alive) { setItems(goals); setError('') } })
      .catch((e) => { if (alive) setError((e as Error).message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [month, refreshKey])

  useEffect(() => {
    const targetMonth = form?.month
    if (!targetMonth || targetMonth === month) { setFormLoading(false); return }
    let alive = true
    setFormLoading(true)
    setFormItems([])
    api<MonthlyGoal[]>(`/api/monthly-goals?month=${targetMonth}`)
      .then((goals) => { if (alive) setFormItems(goals) })
      .catch((e) => { if (alive) setError((e as Error).message) })
      .finally(() => { if (alive) setFormLoading(false) })
    return () => { alive = false }
  }, [form?.month, month])

  const reload = async () => setItems(await api<MonthlyGoal[]>(`/api/monthly-goals?month=${month}`))
  const open = (goal?: MonthlyGoal, parent?: MonthlyGoal) => {
    setEditing(goal ?? null)
    setForm(goal ? { parentId: goal.parentId, parentSubgoalId: goal.parentSubgoalId, month: goal.month, title: goal.title, description: goal.description, nextStep: goal.nextStep }
      : { parentId: parent?.parentId ?? activeParents[0]?.id ?? '', parentSubgoalId: parent?.id ?? null, month: parent?.month ?? month, title: '', description: '', nextStep: '' })
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
        body: JSON.stringify({ ...form, completed: editing?.completed ?? false, failed: editing?.failed ?? false })
      })
      close()
      await reload()
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const toggle = async (goal: MonthlyGoal, failed = false) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      await api(`/api/monthly-goals/${goal.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...goal, completed: failed ? false : !goal.completed, failed: failed ? !goal.failed : false })
      })
      await reload()
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const remove = async (goal: MonthlyGoal) => {
    const descendants = monthlyGoalDescendants(items, goal.id)
    if (busy || !window.confirm(`Удалить подцель «${goal.title}»?${descendants.size ? ` Также будут удалены все вложенные подцели (${descendants.size}).` : ''}`)) return
    setBusy(true); setError('')
    try {
      await api<void>(`/api/monthly-goals/${goal.id}`, { method: 'DELETE' })
      if (editing?.id === goal.id || (editing && descendants.has(editing.id)) || form?.parentSubgoalId === goal.id || (form?.parentSubgoalId && descendants.has(form.parentSubgoalId))) close()
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
        <label>Месяц<input type="month" required value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value, parentSubgoalId: null })} /></label>
        <label>Большая цель<select required value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value, parentSubgoalId: null })}>
          {parents.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
        </select></label>
      </div>
      <label>Родительская подцель <span className="goal-field-hint">Необязательно</span><select disabled={formLoading} value={form.parentSubgoalId ?? ''} onChange={(e) => setForm({ ...form, parentSubgoalId: e.target.value || null })}>
        <option value="">Напрямую в большой цели</option>
        {parentOptions.map(({ goal, depth }) => <option key={goal.id} value={goal.id}>{'↳ '.repeat(Math.min(depth, 4))}{goal.title}</option>)}
      </select></label>
      {editing && monthlyGoalDescendants(items, editing.id).size > 0 && <p className="muted">При смене месяца или большой цели все вложенные подцели перенесутся вместе с этой.</p>}
      <label>Результат подцели<input autoFocus required maxLength={160} placeholder="Например, отработать 4 смены за неделю" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
      <label>Описание <span className="goal-field-hint">Необязательно</span><textarea maxLength={4000} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Как поймёшь, что получилось?" /></label>
      <label>Следующий шаг <span className="goal-field-hint">Необязательно</span><input maxLength={300} value={form.nextStep} onChange={(e) => setForm({ ...form, nextStep: e.target.value })} placeholder="С чего начнёшь?" /></label>
      <div className="form-actions"><button disabled={busy || formLoading}>{busy ? 'Сохраняю…' : editing ? 'Сохранить' : 'Добавить в месяц'}</button><button type="button" className="secondary" onClick={close}>Отмена</button></div>
    </form>}
    {loading ? <p className="muted">Загружаю план месяца…</p> : items.length ? <div className="monthly-goals-list">
      {rows.map(({ goal, depth }) => <article className={`monthly-goal-card ${depth ? 'is-nested' : ''} ${goal.completed ? 'is-complete' : goal.failed ? 'is-failed' : ''}`} style={{ '--goal-depth': Math.min(depth, 4) } as CSSProperties} key={goal.id}>
        <button className="monthly-goal-check" disabled={busy} aria-label={goal.completed ? `Вернуть «${goal.title}» в работу` : `Завершить «${goal.title}»`} aria-pressed={goal.completed} onClick={() => void toggle(goal)}>{goal.completed ? '✓' : goal.failed ? '✕' : ''}</button>
        <div className="monthly-goal-body"><span className="monthly-goal-parent">{depth ? '↳ ' : '↗ '}{items.find((parent) => parent.id === goal.parentSubgoalId)?.title ?? parents.find((parent) => parent.id === goal.parentId)?.title ?? 'Большая цель'}</span><h3>{goal.title}</h3>{(() => {
          const progress = progressFor(goal.id)
          return progress.hasChildren ? <div className="monthly-goal-count"><strong>{progress.complete}/{progress.total}</strong><span className="monthly-goal-track"><span style={{ width: `${Math.min(100, progress.complete / progress.total * 100)}%` }} /></span></div> : null
        })()}{goal.description && <p>{goal.description}</p>}{goal.failed && <small className="goal-failed-label">✕ Не выполнено</small>}{goal.nextStep && !goal.completed && !goal.failed && <small>Дальше: {goal.nextStep}</small>}</div>
        <div className="monthly-goal-actions"><div className="monthly-goal-order" aria-label="Порядок подцели"><button type="button" className="link-button" title="Поднять выше" aria-label={`Поднять «${goal.title}» выше`} disabled={busy || !rows.some(({ goal: other }) => other.parentId === goal.parentId && other.parentSubgoalId === goal.parentSubgoalId && rows.indexOf(rows.find(({ goal: row }) => row.id === other.id)!) < rows.indexOf(rows.find(({ goal: row }) => row.id === goal.id)!))} onClick={() => moveGoal(goal, -1)}>↑</button><button type="button" className="link-button" title="Опустить ниже" aria-label={`Опустить «${goal.title}» ниже`} disabled={busy || rows.filter(({ goal: other }) => other.parentId === goal.parentId && other.parentSubgoalId === goal.parentSubgoalId).at(-1)?.goal.id === goal.id} onClick={() => moveGoal(goal, 1)}>↓</button></div><button className="link-button goal-fail" disabled={busy} aria-pressed={!!goal.failed} onClick={() => void toggle(goal, true)}>{goal.failed ? 'Вернуть в работу' : '✕ Не выполнено'}</button><button className="link-button" disabled={busy} onClick={() => open(undefined, goal)}>+ Подцель</button><button className="link-button" disabled={busy} onClick={() => open(goal)}>Изменить</button><button className="goal-delete" disabled={busy} onClick={() => void remove(goal)}>Удалить</button></div>
      </article>)}
    </div> : <div className="monthly-goals-empty"><span>Пока нет подцелей на этот месяц.</span>{activeParents.length ? <button className="link-button" onClick={() => open()}>Наметить результат →</button> : <span>Сначала создай большую цель ниже.</span>}</div>}
    {!!items.length && <p className="monthly-goals-progress">{items.filter((goal) => goal.completed).length} из {items.length} результатов месяца достигнуто · {items.filter((goal) => goal.failed).length} не выполнено</p>}
  </section>
}
