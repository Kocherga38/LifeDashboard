import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, today } from './api'
import './sleep.css'

type SleepEntry = {
  id: string
  sleptAt: string
  wokeAt: string
  note: string
  dream: string
  durationMinutes: number
}
type SleepForm = Pick<SleepEntry, 'sleptAt' | 'wokeAt' | 'note' | 'dream'>
const empty: SleepForm = { sleptAt: '', wokeAt: '', note: '', dream: '' }
const minutes = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null
  const date = value.slice(0, 10)
  const parts = value.match(/\d+/g)?.map(Number)
  if (!parts || new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).toISOString().slice(0, 10) !== date) return null
  return Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]) / 60000
}
const duration = (value: number) => `${Math.floor(value / 60)} ч ${String(value % 60).padStart(2, '0')} мин`
const dateLabel = (value: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${value.slice(0, 10)}T12:00:00`))
const timeLabel = (value: string) => value.slice(11, 16)
const nowLocal = () => {
  const d = new Date()
  return `${today()}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function Sleep() {
  const [entries, setEntries] = useState<SleepEntry[]>([])
  const [form, setForm] = useState<SleepForm>(empty)
  const [editId, setEditId] = useState<string | null>(null)
  const [month, setMonth] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const editor = useRef<HTMLElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    api<SleepEntry[]>('/api/sleep', { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setEntries(data) })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  const selected = entries.filter((entry) => !month || entry.wokeAt.startsWith(month))
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setHours(0, 0, 0, 0)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
  const recent = entries.filter((entry) => entry.wokeAt.slice(0, 10) >= `${sevenDaysAgo.getFullYear()}-${String(sevenDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(sevenDaysAgo.getDate()).padStart(2, '0')}` && entry.wokeAt.slice(0, 10) <= today())
  const average = recent.length ? Math.round(recent.reduce((sum, entry) => sum + entry.durationMinutes, 0) / recent.length) : null
  const start = minutes(form.sleptAt), end = minutes(form.wokeAt)
  const preview = start !== null && end !== null && end > start && end - start <= 36 * 60 ? end - start : null

  function reset() {
    setForm(empty)
    setEditId(null)
  }
  function edit(entry: SleepEntry) {
    setForm({ sleptAt: entry.sleptAt, wokeAt: entry.wokeAt, note: entry.note, dream: entry.dream })
    setEditId(entry.id)
    setError('')
    setNotice('')
    editor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (preview === null) {
      setError('Укажи время сна и пробуждения. Пробуждение должно быть позже, длительность — не больше 36 часов.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const entry = await api<SleepEntry>(editId ? `/api/sleep/${editId}` : '/api/sleep', {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      setEntries((current) => [...current.filter((item) => item.id !== entry.id), entry].sort((a, b) => b.wokeAt.localeCompare(a.wokeAt)))
      setNotice(editId ? 'Запись обновлена.' : 'Сон записан.')
      reset()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function remove(entry: SleepEntry) {
    if (busy || !window.confirm(`Удалить запись сна за ${dateLabel(entry.wokeAt)}?`)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api(`/api/sleep/${entry.id}`, { method: 'DELETE' })
      setEntries((current) => current.filter((item) => item.id !== entry.id))
      if (editId === entry.id) reset()
      setNotice('Запись удалена.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return <main className="sleep-page">
    <header>
      <div>
        <p className="eyebrow">TRELLIS / ВОССТАНОВЛЕНИЕ</p>
        <h1>Сон</h1>
        <p className="muted">Когда лёг, когда проснулся и что запомнилось из снов.</p>
      </div>
      <div className="period">
        <label>Месяц <input type="month" value={month} min="1900-01" max="2100-12" onChange={(e) => setMonth(e.target.value)} /></label>
        {month && <button className="secondary" onClick={() => setMonth('')}>Всё время</button>}
      </div>
    </header>
    {error && <p className="message error" role="alert">{error}</p>}
    {notice && <p className="message success" role="status">{notice}</p>}
    <section className="sleep-summary">
      <article className="card"><span className="kicker">ПОСЛЕДНИЙ СОН</span><strong>{entries[0] ? duration(entries[0].durationMinutes) : '—'}</strong><small>{entries[0] ? `Пробуждение ${dateLabel(entries[0].wokeAt)}` : 'Пока нет записей'}</small></article>
      <article className="card"><span className="kicker">СРЕДНЕЕ ЗА 7 ДНЕЙ</span><strong>{average === null ? '—' : duration(average)}</strong><small>{recent.length ? `${recent.length} ${recent.length === 1 ? 'запись' : 'записей'} за последние 7 дней` : 'Пока нет записей за 7 дней'}</small></article>
    </section>
    <section className={`card sleep-editor ${editId ? 'editing' : ''}`} ref={editor}>
      <div className="section-heading"><h2>{editId ? 'Редактировать сон' : 'Записать сон'}</h2>{editId && <span className="badge">Редактирование</span>}</div>
      <form onSubmit={(e) => void save(e)}>
        <div className="sleep-fields">
          <label>Лёг спать<span className="sleep-input-line"><input required type="datetime-local" value={form.sleptAt} onChange={(e) => setForm({ ...form, sleptAt: e.target.value })} /><button type="button" className="secondary sleep-now" onClick={() => setForm({ ...form, sleptAt: nowLocal() })}>Сейчас</button></span></label>
          <label>Проснулся<span className="sleep-input-line"><input required type="datetime-local" value={form.wokeAt} onChange={(e) => setForm({ ...form, wokeAt: e.target.value })} /><button type="button" className="secondary sleep-now" onClick={() => setForm({ ...form, wokeAt: nowLocal() })}>Сейчас</button></span></label>
        </div>
        <div className="sleep-preview" aria-live="polite">{preview === null ? 'Выбери даты и время — длительность посчитается сама.' : <>Длительность <strong>{duration(preview)}</strong></>}</div>
        <label className="sleep-note">Комментарий <textarea maxLength={5000} rows={3} placeholder="Как спалось? Что повлияло на сон?" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        <label className="sleep-note sleep-dream">Что приснилось <span className="muted">Необязательно — если запомнил сон, запиши его здесь.</span><textarea maxLength={10000} rows={5} placeholder="Что происходило во сне? Какие детали и ощущения остались?" value={form.dream} onChange={(e) => setForm({ ...form, dream: e.target.value })} /></label>
        <div className="form-actions"><button disabled={busy}>{busy ? 'Сохраняем…' : editId ? 'Сохранить изменения' : 'Сохранить сон'}</button>{editId && <button type="button" className="secondary" disabled={busy} onClick={reset}>Отмена</button>}</div>
      </form>
    </section>
    <section className="card sleep-history">
      <div className="section-heading"><h2>История · {selected.length}</h2></div>
      {loading ? <p className="muted">Загружаем записи…</p> : selected.length === 0 ? <p className="muted">{month ? 'В этом месяце записей нет.' : 'Записей пока нет. Внеси первый сон выше.'}</p> :
        <div className="sleep-list">{selected.map((entry) => <article className="sleep-row" key={entry.id}>
          <div className="sleep-date"><small>ПРОБУЖДЕНИЕ</small><strong>{dateLabel(entry.wokeAt)}</strong></div>
          <div className="sleep-interval"><span>{dateLabel(entry.sleptAt)} · {timeLabel(entry.sleptAt)} → {dateLabel(entry.wokeAt)} · {timeLabel(entry.wokeAt)}</span>{entry.note && <p>{entry.note}</p>}{entry.dream && <div className="sleep-dream-entry"><strong>Приснилось</strong><p>{entry.dream}</p></div>}</div>
          <strong className="sleep-duration">{duration(entry.durationMinutes)}</strong>
          <div className="sleep-actions"><button className="secondary" disabled={busy} onClick={() => edit(entry)}>Изменить</button><button className="secondary" disabled={busy} onClick={() => void remove(entry)}>Удалить</button></div>
        </article>)}</div>}
    </section>
  </main>
}
