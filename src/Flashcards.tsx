import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './api'
import './personal.css'

type Card = { id: string; front: string; back: string; deck: string; dueDate: string; intervalDays: number; repetitions: number; lapses: number }

export default function Flashcards() {
  const [cards, setCards] = useState<Card[]>([])
  const [review, setReview] = useState<Card | null>(null)
  const [shown, setShown] = useState(false)
  const [editing, setEditing] = useState<Card | null>(null)
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [deck, setDeck] = useState('Основная')
  const [error, setError] = useState('')
  const load = async () => {
    const x = await api<Card[]>('/api/flashcards')
    setCards(x)
    if (review) setReview(x.find((c) => c.id === review.id) ?? null)
  }
  useEffect(() => { load().catch((e) => setError(e.message)) }, [])
  const due = cards.filter((c) => c.dueDate <= new Date().toISOString().slice(0, 10))
  const reset = () => { setEditing(null); setFront(''); setBack(''); setDeck('Основная') }
  const edit = (c: Card) => { setEditing(c); setFront(c.front); setBack(c.back); setDeck(c.deck) }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api(editing ? `/api/flashcards/${editing.id}` : '/api/flashcards', {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ front, back, deck })
      })
      reset(); await load()
    } catch (e) { setError((e as Error).message) }
  }
  const remove = async (c: Card) => {
    if (!confirm('Удалить карточку?')) return
    await api(`/api/flashcards/${c.id}`, { method: 'DELETE' })
    if (review?.id === c.id) setReview(null)
    await load()
  }
  const start = () => { setReview(due[0] ?? null); setShown(false) }
  const rate = async (rating: 'again' | 'hard' | 'good' | 'easy') => {
    if (!review) return
    await api(`/api/flashcards/${review.id}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating })
    })
    const rest = due.filter((c) => c.id !== review.id)
    await load(); setReview(rest[0] ?? null); setShown(false)
  }
  return <main>
    <header><div><div className="eyebrow">SPACED REPETITION</div><h1>Карточки</h1><p className="muted">Простое интервальное повторение: ответил → оценил → карточка сама назначила следующую дату.</p></div><button onClick={start}>Повторить · {due.length}</button></header>
    {error && <div className="message error">{error}</div>}
    {review && <section className="card review-card">
      <span className="badge">{review.deck}</span><h2>{review.front}</h2>
      {shown ? <><div className="review-answer">{review.back}</div><div className="rating-row"><button onClick={() => rate('again')}>Снова</button><button onClick={() => rate('hard')} className="secondary">Трудно</button><button onClick={() => rate('good')} className="secondary">Хорошо</button><button onClick={() => rate('easy')} className="secondary">Легко</button></div></> : <button onClick={() => setShown(true)}>Показать ответ</button>}
    </section>}
    <div className="columns">
      <form className="card" onSubmit={submit}><h2>{editing ? 'Редактировать карточку' : 'Новая карточка'}</h2><label>Колода<input value={deck} onChange={(e) => setDeck(e.target.value)} maxLength={100} /></label><label>Лицевая сторона<textarea className="small-area" value={front} onChange={(e) => setFront(e.target.value)} required /></label><label>Оборотная сторона<textarea className="small-area" value={back} onChange={(e) => setBack(e.target.value)} required /></label><div className="form-actions"><button>{editing ? 'Сохранить' : 'Добавить'}</button>{editing && <button className="secondary" type="button" onClick={reset}>Отмена</button>}</div></form>
      <section className="card"><div className="section-heading"><h2>Все карточки</h2><span className="badge">{cards.length}</span></div><div className="flash-list">{cards.map((c) => <div className="flash-row" key={c.id}><div><strong>{c.front}</strong><small>{c.deck} · следующее: {c.dueDate} · интервал {c.intervalDays} дн.</small></div><div><button className="icon-button" onClick={() => edit(c)}>✎</button><button className="icon-button delete" onClick={() => remove(c)}>×</button></div></div>)}</div></section>
    </div>
  </main>
}
