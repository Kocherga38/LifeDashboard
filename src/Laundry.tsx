import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, today } from './api'
import { addDays, dateLabel, dayDifference } from '../shared/household'
import type { LaundryItem, LaundryWash } from '../shared/household'
import { prepareDiaryImage } from './diary-images'
import { HouseholdStatus, send, useHouseholdAction } from './household-ui'
import './household.css'
const blankItem = (): Omit<LaundryItem, 'id'> => ({ name: '', details: '', intervalDays: null, photo: '' })
export default function Laundry() {
  const [items, setItems] = useState<LaundryItem[]>([]), [washes, setWashes] = useState<LaundryWash[]>([])
  const [loading, setLoading] = useState(true), [loaded, setLoaded] = useState(false)
  const [itemForm, setItemForm] = useState<ReturnType<typeof blankItem> | null>(null), [itemId, setItemId] = useState<string | null>(null)
  const [selection, setSelection] = useState<string[]>([]), [washForm, setWashForm] = useState<{ id?: string; itemIds: string[]; date: string; note: string } | null>(null)
  const [month, setMonth] = useState(() => today().slice(0,7)), [filter, setFilter] = useState('')
  const { busy, error, run } = useHouseholdAction()
  const now = today(), disabled = busy || !loaded
  useEffect(() => { if (itemForm || washForm) document.querySelector('.household-editor')?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, [!!itemForm, !!washForm])
  async function load() {
    const [i,w] = await Promise.all([api<LaundryItem[]>('/api/laundry/items'),api<LaundryWash[]>('/api/laundry/washes')])
    setItems(i); setWashes(w); setLoaded(true)
  }
  useEffect(() => { void run(async () => { try { await load() } finally { setLoading(false) } }) }, [])
  function editItem(item?: LaundryItem) { setItemId(item?.id ?? null); setItemForm(item ?? blankItem()); setWashForm(null) }
  function openWash(ids: string[], date = now) { setItemForm(null); setWashForm({ itemIds: ids, date, note: '' }) }
  function editWash(w: LaundryWash) { setItemForm(null); setWashForm({ id: w.id, itemIds: [w.itemId], date: w.date, note: w.note }) }
  function submitItem(event: FormEvent) {
    event.preventDefault(); void run(async () => {
      await send(`/api/laundry/items${itemId ? `/${itemId}` : ''}`, itemId ? 'PUT' : 'POST', itemForm)
      setItemForm(null); await load()
    })
  }
  function submitWash(event: FormEvent) {
    event.preventDefault(); if (!washForm) return
    void run(async () => {
      await send(`/api/laundry/washes${washForm.id ? `/${washForm.id}` : ''}`, washForm.id ? 'PUT' : 'POST', washForm)
      setWashForm(null); setSelection([]); await load()
    })
  }
  function removeItem(item: LaundryItem) {
    if (!confirm(`Удалить «${item.name}» и историю стирок? Изменения останутся в журнале действий.`)) return
    void run(async () => { await send(`/api/laundry/items/${item.id}`, 'DELETE'); setSelection((s) => s.filter((id) => id !== item.id)); if (filter === item.id) setFilter(''); await load() })
  }
  function removeWash(w: LaundryWash) {
    if (!confirm(`Удалить отметку стирки за ${dateLabel(w.date)}?`)) return
    void run(async () => { await send(`/api/laundry/washes/${w.id}`, 'DELETE'); await load() })
  }
  const [year, monthNumber] = month.split('-').map(Number), days = new Date(year, monthNumber, 0).getDate()
  const visible = items.filter((i) => !filter || i.id === filter)
  const marks = new Map<string, LaundryWash>()
  for (const w of washes) marks.set(`${w.itemId}:${w.date}`, w)
  const shift = (n: number) => setMonth(new Date(Date.UTC(year,monthNumber - 1 + n,1)).toISOString().slice(0,7))
  return <main className="household-page">
    <header><div><div className="eyebrow">ДОМ И ВЕЩИ</div><h1>Стирка</h1><p className="muted">Когда стирал вещи. Выбери несколько — и отметь одну общую стирку.</p></div><button disabled={disabled} onClick={() => editItem()}>+ Вещь</button></header>
    <HouseholdStatus loading={loading} error={error} />
    {itemForm && <section className="card household-editor"><h2>{itemId ? 'Изменить вещь' : 'Новая вещь'}</h2><form onSubmit={submitItem}><fieldset disabled={busy}>
      <div className="household-fields"><label>Название<input autoFocus required maxLength={120} value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} placeholder="Чёрная футболка" /></label><label>Описание<input maxLength={250} value={itemForm.details} onChange={(e) => setItemForm({ ...itemForm, details: e.target.value })} placeholder="Материал, режим стирки…" /></label><label>Напомнить через, дней<input type="number" min={1} max={3650} value={itemForm.intervalDays ?? ''} onChange={(e) => setItemForm({ ...itemForm, intervalDays: e.target.value ? Number(e.target.value) : null })} placeholder="Не напоминать" /></label><label>Фото вещи<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (file) void run(async () => { const image = await prepareDiaryImage(file); setItemForm((form) => form && ({ ...form, photo: image.dataUrl })) }) }} /></label></div>
      <p className="muted">Интервал необязателен. Дата стирки сама по себе не означает, что вещь грязная.</p>
      {itemForm.photo && <div className="household-photo-editor"><img src={itemForm.photo} alt="Фото вещи" /><button type="button" className="secondary" onClick={() => setItemForm({ ...itemForm, photo: '' })}>Убрать фото</button></div>}
      <div className="household-actions"><button type="submit">Сохранить</button><button type="button" className="secondary" onClick={() => setItemForm(null)}>Отмена</button></div>
    </fieldset></form></section>}
    {washForm && <section className="card household-editor"><h2>{washForm.id ? 'Изменить стирку' : 'Отметить стирку'}</h2><p>{washForm.itemIds.map((id) => items.find((i) => i.id === id)?.name).join(', ')}</p><form onSubmit={submitWash}><fieldset disabled={busy}><div className="household-fields"><label>Дата<input autoFocus type="date" required min="1900-01-01" max={now} value={washForm.date} onChange={(e) => setWashForm({ ...washForm, date: e.target.value })} /></label><label>Комментарий<input maxLength={500} value={washForm.note} onChange={(e) => setWashForm({ ...washForm, note: e.target.value })} placeholder="Необязательно" /></label></div><div className="household-actions"><button type="submit">Сохранить стирку</button><button type="button" className="secondary" onClick={() => setWashForm(null)}>Отмена</button></div></fieldset></form></section>}
    <div className="household-toolbar"><label>Показать вещь<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">Все вещи</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label><button disabled={disabled || !selection.length} onClick={() => openWash(selection)}>Постирал выбранные · {selection.length}</button>{selection.length > 0 && <button className="secondary" disabled={busy} onClick={() => setSelection([])}>Снять выбор</button>}</div>
    <div className="household-grid">{visible.map((i) => {
      const last = washes.find((w) => w.itemId === i.id && w.date <= now), elapsed = last ? dayDifference(last.date,now) : null
      const due = last && i.intervalDays ? addDays(last.date,i.intervalDays) : null
      return <article className="card household-item" key={i.id}><div className="household-item-heading"><label className="household-select"><input type="checkbox" disabled={disabled} checked={selection.includes(i.id)} onChange={(e) => setSelection((s) => e.target.checked ? [...s,i.id] : s.filter((id) => id !== i.id))} /><strong>{i.name}</strong></label>{i.photo && <img className="household-photo" src={i.photo} alt={i.name} />}</div>{i.details && <p className="muted">{i.details}</p>}<p>{last ? <>Последняя стирка <strong>{dateLabel(last.date)}</strong><small className="household-meta">Прошло {elapsed} дн.</small></> : 'Стирок пока нет'}</p>{due && <p className="household-reminder">{due <= now ? 'Напоминание: пора проверить вещь' : `Напомнить ${dateLabel(due)}`}</p>}<div className="household-actions"><button disabled={disabled} onClick={() => openWash([i.id])}>Постирал</button><button className="secondary" disabled={disabled} onClick={() => editItem(i)}>Изменить</button><button className="icon-button delete" aria-label={`Удалить вещь ${i.name}`} disabled={disabled} onClick={() => removeItem(i)}>×</button></div></article>
    })}</div>
    {!loading && loaded && !items.length && <section className="card empty"><h2>Начни с вещей, которые хочешь отслеживать</h2><p className="muted">Добавь одежду, полотенца или постельное бельё, затем укажи даты прежних стирок.</p></section>}
    {!!items.length && <section className="card household-calendar"><div className="household-toolbar"><h2>Календарь стирок</h2><button className="secondary" aria-label="Предыдущий месяц" onClick={() => shift(-1)}>←</button><input aria-label="Месяц стирок" type="month" min="1900-01" max={now.slice(0,7)} value={month} onChange={(e) => { if (e.target.value) setMonth(e.target.value) }} /><button className="secondary" aria-label="Следующий месяц" disabled={month >= now.slice(0,7)} onClick={() => shift(1)}>→</button></div><p className="muted">Нажми на день, чтобы добавить стирку или изменить существующую отметку.</p><div className="household-scroll"><table className="household-calendar-table"><thead><tr><th>Вещь</th>{Array.from({length: days},(_,i) => <th key={i}>{i+1}</th>)}</tr></thead><tbody>{visible.map((item) => <tr key={item.id}><th>{item.name}</th>{Array.from({length: days},(_,index) => { const date = `${month}-${String(index+1).padStart(2,'0')}`, mark = marks.get(`${item.id}:${date}`); return <td key={date}><button className={`secondary wash-mark ${mark ? 'done' : ''}`} disabled={disabled || date > now} aria-label={`${item.name}, ${dateLabel(date)}${mark ? ', постирано' : ''}`} onClick={() => mark ? editWash(mark) : openWash([item.id],date)}>{mark ? '✓' : '·'}</button></td> })}</tr>)}</tbody></table></div></section>}
    {!!washes.length && <section className="card household-history"><h2>История стирок</h2>{washes.filter((w) => !filter || w.itemId === filter).map((w) => <div className="household-history-row" key={w.id}><div><strong>{items.find((i) => i.id === w.itemId)?.name}</strong><small>{dateLabel(w.date)}{w.note && ` · ${w.note}`}</small></div><div className="household-actions"><button className="secondary" disabled={disabled} onClick={() => editWash(w)}>Изменить</button><button className="icon-button delete" aria-label={`Удалить стирку ${dateLabel(w.date)}`} disabled={disabled} onClick={() => removeWash(w)}>×</button></div></div>)}</section>}
  </main>
}
