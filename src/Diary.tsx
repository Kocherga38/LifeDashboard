import { FormEvent, useEffect, useState } from 'react'
import { api, today } from './api'
import './personal.css'

type Entry = { id: string; date: string; title: string; content: string; createdAt: string }

export default function Diary() {
  const [items, setItems] = useState<Entry[]>([])
  const [editing, setEditing] = useState<Entry | null>(null)
  const [date, setDate] = useState(today())
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const load = () => api<Entry[]>('/api/diary').then(setItems)
  useEffect(() => { load().catch((e) => setError(e.message)) }, [])
  const reset = () => { setEditing(null); setDate(today()); setTitle(''); setContent('') }
  const edit = (x: Entry) => { setEditing(x); setDate(x.date); setTitle(x.title); setContent(x.content) }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const body = JSON.stringify({ date, title, content })
      await api(editing ? `/api/diary/${editing.id}` : '/api/diary', {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body
      })
      reset(); await load()
    } catch (e) { setError((e as Error).message) }
  }
  const remove = async (x: Entry) => {
    if (!confirm('Удалить эту запись из дневника?')) return
    await api(`/api/diary/${x.id}`, { method: 'DELETE' })
    if (editing?.id === x.id) reset()
    await load()
  }
  return <main>
    <header><div><div className="eyebrow">JOURNAL</div><h1>Дневник</h1><p className="muted">Отдельное место для мыслей, событий и состояния по дням.</p></div><button onClick={reset}>+ Запись</button></header>
    {error && <div className="message error">{error}</div>}
    <div className="diary-layout">
      <form className="card diary-form" onSubmit={submit}>
        <label>Дата<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label>Заголовок<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Необязательно" /></label>
        <label>Запись<textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Что произошло? Что чувствуешь? Что важно запомнить?" required /></label>
        <div className="form-actions"><button>{editing ? 'Сохранить' : 'Добавить'}</button>{editing && <button type="button" className="secondary" onClick={reset}>Отмена</button>}</div>
      </form>
      <section className="diary-feed">
        {items.map((x) => <article className="card diary-entry" key={x.id}>
          <div className="entry-head"><div><div className="eyebrow">{new Date(x.date + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>{x.title && <h2>{x.title}</h2>}</div><div><button className="icon-button" onClick={() => edit(x)}>✎</button><button className="icon-button delete" onClick={() => remove(x)}>×</button></div></div>
          <p>{x.content}</p>
        </article>)}
        {!items.length && <div className="card muted">Записей пока нет.</div>}
      </section>
    </div>
  </main>
}
