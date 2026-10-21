import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, FormEvent } from 'react'
import { api, today } from './api'
import './personal.css'
import { MAX_DIARY_IMAGES, diaryFileIsImage } from '../shared/diary'
import type { DiaryImage } from '../shared/diary'
import { prepareDiaryAttachment } from './diary-images'

type Entry = { id: string; date: string; title: string; content: string; createdAt: string; images?: DiaryImage[] }

export default function Diary() {
  const [items, setItems] = useState<Entry[]>([])
  const [editing, setEditing] = useState<Entry | null>(null)
  const [date, setDate] = useState(today())
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [images, setImages] = useState<DiaryImage[]>([])
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const filesInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const load = () => api<Entry[]>('/api/diary').then(setItems)
  useEffect(() => { load().catch((e) => setError(e.message)) }, [])
  const reset = () => { setEditing(null); setDate(today()); setTitle(''); setContent(''); setImages([]); setError('') }
  const edit = (x: Entry) => { setEditing(x); setDate(x.date); setTitle(x.title); setContent(x.content); setImages(x.images ?? []); setError('') }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const body = JSON.stringify({ date, title, content, images })
      await api(editing ? `/api/diary/${editing.id}` : '/api/diary', {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body
      })
      reset(); await load()
    } catch (e) { setError((e as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  const addImages = async (files: File[]) => {
    if (lock.current || !files.length) return
    if (images.length + files.length > MAX_DIARY_IMAGES) {
      setError(`Можно добавить до ${MAX_DIARY_IMAGES} вложений.`); return
    }
    lock.current = true; setBusy(true); setError('')
    try {
      const attachments: DiaryImage[] = []
      for (const file of files) attachments.push(await prepareDiaryAttachment(file))
      setImages((current) => [...current, ...attachments])
    } catch (e) { setError((e as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  const paste = (e: ClipboardEvent<HTMLFormElement>) => {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile()).filter((file): file is File => file !== null)
    if (!files.length) return
    e.preventDefault()
    void addImages(files)
  }
  const remove = async (x: Entry) => {
    if (lock.current || !confirm('Удалить эту запись из дневника?')) return
    lock.current = true; setBusy(true); setError('')
    try {
      await api(`/api/diary/${x.id}`, { method: 'DELETE' })
      if (editing?.id === x.id) reset()
      await load()
    } catch (e) { setError((e as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  return <main>
    <header><div><div className="eyebrow">JOURNAL</div><h1>Дневник</h1><p className="muted">Отдельное место для мыслей, событий и состояния по дням.</p></div><button disabled={busy} onClick={reset}>+ Запись</button></header>
    {error && <div className="message error">{error}</div>}
    <div className="diary-layout">
      <form className="card diary-form" onSubmit={submit} onPaste={paste} aria-busy={busy}>
        <fieldset disabled={busy} className="diary-fields">
        <label>Дата<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label>Заголовок<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Необязательно" /></label>
        <label>Запись<textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Что произошло? Что чувствуешь? Что важно запомнить?" required={!images.length} maxLength={500000} /></label>
        <div className="diary-attachments">
          <span>Вложения</span>
          <input ref={filesInput} type="file" multiple hidden onChange={(e) => { void addImages(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          <button type="button" className="secondary" disabled={images.length >= MAX_DIARY_IMAGES} onClick={() => filesInput.current?.click()}>Добавить файлы</button>
          <small className="muted">Любые файлы, включая аудио, MIDI, PDF и изображения. До 8 вложений без ограничения по размеру файла. Изображения уменьшаются автоматически; можно вставлять файлы через ⌘V / Ctrl+V. Большие файлы могут долго сохраняться и увеличивают размер базы.</small>
          {images.length > 0 && <div className="diary-images diary-image-previews">{images.map((image) => <figure key={image.id}>
            {diaryFileIsImage(image) ? <img src={image.dataUrl} alt={image.name} /> : <a href={image.dataUrl} download={image.name}>📎 {image.name}</a>}
            <button type="button" className="icon-button delete" aria-label={`Удалить вложение ${image.name}`} onClick={() => setImages((current) => current.filter((x) => x.id !== image.id))}>×</button>
          </figure>)}</div>}
        </div>
        <div className="form-actions"><button>{editing ? 'Сохранить' : 'Добавить'}</button>{editing && <button type="button" className="secondary" onClick={reset}>Отмена</button>}</div>
        </fieldset>
      </form>
      <section className="diary-feed">
        {items.map((x) => <article className="card diary-entry" key={x.id}>
          <div className="entry-head"><div><div className="eyebrow">{new Date(x.date + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>{x.title && <h2>{x.title}</h2>}</div><div><button disabled={busy} className="icon-button" onClick={() => edit(x)}>✎</button><button disabled={busy} className="icon-button delete" onClick={() => remove(x)}>×</button></div></div>
          {x.content && <p>{x.content}</p>}
          {!!x.images?.length && <div className="diary-images">{x.images.map((image) => <figure key={image.id}>{diaryFileIsImage(image) ? <img src={image.dataUrl} alt={image.name} loading="lazy" /> : <span>📎 {image.name}</span>}<a href={image.dataUrl} download={image.name}>Скачать</a></figure>)}</div>}
        </article>)}
        {!items.length && <div className="card muted">Записей пока нет.</div>}
      </section>
    </div>
  </main>
}
