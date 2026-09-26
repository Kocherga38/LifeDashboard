import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, today } from './api'
import './planning.css'
type Session = { id: string; date: string; minutes: number; partner: string; phrases: string; note: string }
const initial = () => ({ date: today(), minutes: '20', partner: '', phrases: '', note: '' })
export default function SpeakingPractice() {
  const [items, setItems] = useState<Session[]>([])
  const [form, setForm] = useState(initial)
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => api<Session[]>('/api/speaking-sessions').then(setItems)
  useEffect(() => { void load().catch((e) => setError(e.message)) }, [])
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { await api(editId ? `/api/speaking-sessions/${editId}` : '/api/speaking-sessions', { method: editId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, minutes: Number(form.minutes) }) }); setForm(initial()); setEditId(null); await load() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function remove(id: string) {
    if (!confirm('Удалить разговор?')) return
    try { await api(`/api/speaking-sessions/${id}`, { method: 'DELETE' }); await load() }
    catch (e) { setError((e as Error).message) }
  }
  const full = items.filter((x) => x.minutes >= 20).length
  return <section className="card speaking-panel"><div className="section-heading"><div><span className="kicker">ENGLISH SPEAKING</span><h2>Разговорная практика</h2></div><span className="badge">{full}/20 разговоров от 20 минут</span></div>
    <p className="muted">Всего {items.reduce((sum, x) => sum + x.minutes, 0)} минут. Короткие разговоры тоже остаются в истории, но в цель 20 × 20 минут не входят.</p>
    {error && <p className="message error" role="alert">{error}</p>}
    <form className="reflection-form" onSubmit={(e) => void save(e)}><div className="planning-fields"><label>Дата<input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label><label>Минут<input required type="number" min="1" max="600" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} /></label></div><label>С кем или где<input maxLength={120} value={form.partner} onChange={(e) => setForm({ ...form, partner: e.target.value })} placeholder="Speaking Club, Самат, ChatGPT…" /></label><label>Фразы, которые хочу запомнить<textarea maxLength={3000} value={form.phrases} onChange={(e) => setForm({ ...form, phrases: e.target.value })} /></label><label>Что заметил в разговоре<textarea maxLength={3000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label><div className="form-actions"><button disabled={busy}>{editId ? 'Сохранить' : '+ Записать разговор'}</button>{editId && <button type="button" className="secondary" onClick={() => { setEditId(null); setForm(initial()) }}>Отмена</button>}</div></form>
    <div className="planning-list">{items.map((x) => <div className="planning-row" key={x.id}><div><strong>{x.date} · {x.minutes} мин{x.partner && ` · ${x.partner}`}</strong>{x.phrases && <p>Фразы: {x.phrases}</p>}{x.note && <p>{x.note}</p>}</div><div className="form-actions"><button className="secondary" onClick={() => { setEditId(x.id); setForm({ date: x.date, minutes: String(x.minutes), partner: x.partner, phrases: x.phrases, note: x.note }) }}>Изменить</button><button className="secondary" onClick={() => void remove(x.id)}>×</button></div></div>)}</div>
  </section>
}
