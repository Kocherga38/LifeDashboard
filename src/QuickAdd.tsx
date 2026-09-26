import { useState } from 'react'
import type { FormEvent } from 'react'
import { api, today } from './api'
import './planning.css'

type Kind = 'expense' | 'meal' | 'task' | 'sleep' | 'diary'
const labels: Record<Kind, string> = { expense: 'Расход', meal: 'Еда', task: 'Задача', sleep: 'Сон', diary: 'Мысль' }
const initial = () => ({ date: today(), title: '', amount: '', category: 'Продукты', meal: '', content: '', sleptAt: '', wokeAt: '', note: '', dream: '' })
export default function QuickAdd({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>('expense')
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const field = (key: keyof ReturnType<typeof initial>, value: string) => setForm((f) => ({ ...f, [key]: value }))
  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    const payload = kind === 'expense' ? { title: form.title, amount: Number(form.amount), category: form.category, type: 'expense', date: form.date }
      : kind === 'meal' ? { date: form.date, meal: form.meal, description: form.content }
      : kind === 'task' ? { title: form.title, date: form.date }
      : kind === 'sleep' ? { sleptAt: form.sleptAt, wokeAt: form.wokeAt, note: form.note, dream: form.dream }
      : { date: form.date, title: form.title, content: form.content }
    const endpoint = { expense: '/api/expenses', meal: '/api/meal-notes', task: '/api/tasks', sleep: '/api/sleep', diary: '/api/diary' }[kind]
    try {
      await api(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      setForm(initial()); setNotice('Запись сохранена.')
      onSaved()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }
  return <section className="card quick-add">
    <div className="section-heading"><div><span className="kicker">ОДНИМ ДВИЖЕНИЕМ</span><h2>Быстрая запись</h2></div><button className="secondary" onClick={() => setOpen(!open)}>{open ? 'Свернуть' : '+ Добавить'}</button></div>
    {open && <><div className="quick-add-tabs" role="group" aria-label="Что добавить">{(Object.keys(labels) as Kind[]).map((x) => <button key={x} className={kind === x ? 'active' : 'secondary'} onClick={() => { setKind(x); setError(''); setNotice('') }}>{labels[x]}</button>)}</div>
      <form onSubmit={(e) => void save(e)}>
        {kind !== 'sleep' && <label>Дата<input required type="date" value={form.date} onChange={(e) => field('date', e.target.value)} /></label>}
        {(kind === 'expense' || kind === 'task') && <label>Название<input required maxLength={100} value={form.title} onChange={(e) => field('title', e.target.value)} placeholder={kind === 'task' ? 'Что сделать?' : 'Что купил?'} /></label>}
        {kind === 'expense' && <div className="planning-fields"><label>Сумма, ₽<input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => field('amount', e.target.value)} /></label><label>Категория<input required maxLength={100} value={form.category} onChange={(e) => field('category', e.target.value)} /></label></div>}
        {kind === 'meal' && <><label>Приём пищи<select value={form.meal} onChange={(e) => field('meal', e.target.value)}><option value="">Не указывать</option>{['Завтрак','Обед','Ужин','Перекус'].map((x) => <option key={x}>{x}</option>)}</select></label><label>Что ел<textarea required maxLength={5000} value={form.content} onChange={(e) => field('content', e.target.value)} placeholder="Например, хлеб с яйцами и чай. Граммы не нужны." /></label></>}
        {kind === 'sleep' && <><div className="planning-fields"><label>Лёг<input required type="datetime-local" value={form.sleptAt} onChange={(e) => field('sleptAt', e.target.value)} /></label><label>Проснулся<input required type="datetime-local" value={form.wokeAt} onChange={(e) => field('wokeAt', e.target.value)} /></label></div><label>Как спалось<input maxLength={5000} value={form.note} onChange={(e) => field('note', e.target.value)} /></label><label>Что приснилось, если помнишь<textarea maxLength={10000} value={form.dream} onChange={(e) => field('dream', e.target.value)} /></label></>}
        {kind === 'diary' && <><label>Заголовок, если нужен<input maxLength={200} value={form.title} onChange={(e) => field('title', e.target.value)} /></label><label>Мысль<textarea required value={form.content} onChange={(e) => field('content', e.target.value)} /></label></>}
        <button disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
      </form></>}
    {error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success" role="status">{notice}</p>}
  </section>
}
