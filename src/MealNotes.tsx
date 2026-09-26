import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, today } from './api'
import './planning.css'
type Note = { id: string; date: string; meal: string; description: string }
export default function MealNotes({ month }: { month: string }) {
  const [items, setItems] = useState<Note[]>([])
  const [form, setForm] = useState({ date: today(), meal: '', description: '' })
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => api<Note[]>('/api/meal-notes').then(setItems)
  useEffect(() => { void load().catch((e) => setError(e.message)) }, [])
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { await api(editId ? `/api/meal-notes/${editId}` : '/api/meal-notes', { method: editId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }); setForm({ date: today(), meal: '', description: '' }); setEditId(null); await load() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function remove(id: string) {
    if (!confirm('Удалить описание еды?')) return
    try { await api(`/api/meal-notes/${id}`, { method: 'DELETE' }); await load() }
    catch (e) { setError((e as Error).message) }
  }
  const selected = items.filter((x) => !month || x.date.startsWith(month))
  return <section className="card meal-notes"><div className="section-heading"><h2>Еда своими словами · {selected.length}</h2></div>
    <p className="muted">Запиши то, что помнишь. Такие записи не прибавляются к КБЖУ без граммовки.</p>
    {error && <p className="message error">{error}</p>}
    <form className="reflection-form" onSubmit={(e) => void save(e)}><div className="planning-fields"><label>Дата<input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label><label>Приём пищи<select value={form.meal} onChange={(e) => setForm({ ...form, meal: e.target.value })}><option value="">Не указывать</option>{['Завтрак','Обед','Ужин','Перекус'].map((x) => <option key={x}>{x}</option>)}</select></label></div><label>Что ел<textarea required maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label><div className="form-actions"><button disabled={busy}>{editId ? 'Сохранить изменения' : 'Добавить'}</button>{editId && <button type="button" className="secondary" onClick={() => { setEditId(null); setForm({ date: today(), meal: '', description: '' }) }}>Отмена</button>}</div></form>
    <div className="planning-list">{selected.map((x) => <div className="planning-row" key={x.id}><div><strong>{x.date}{x.meal ? ` · ${x.meal}` : ''}</strong><p>{x.description}</p></div><div className="form-actions"><button className="secondary" onClick={() => { setEditId(x.id); setForm({ date: x.date, meal: x.meal, description: x.description }) }}>Изменить</button><button className="secondary" onClick={() => void remove(x.id)}>×</button></div></div>)}</div>
  </section>
}
