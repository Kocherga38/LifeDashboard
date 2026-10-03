import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, FormEvent } from 'react'
import { useDiaryDraft } from './diary-draft'
import { diaryAttachmentsSaved } from './diary-save'
import { api, today } from './api'
import './personal.css'
import { MAX_DIARY_IMAGES } from '../shared/diary'
import type { DiaryImage } from '../shared/diary'
import { MAX_DIARY_AUDIO } from '../shared/diary-audio'
import type { DiaryAudio } from '../shared/diary-audio'
import { prepareDiaryAudio, useDiaryRecorder } from './diary-audio'
import { prepareDiaryImage } from './diary-images'

type Entry = { id: string; date: string; title: string; content: string; createdAt: string; images?: DiaryImage[]; audio?: DiaryAudio[] }

export default function Diary() {
  const [items, setItems] = useState<Entry[]>([])
  const [editing, setEditing] = useState<Entry | null>(null)
  const [date, setDate] = useState(today())
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [images, setImages] = useState<DiaryImage[]>([])
  const [audio, setAudio] = useState<DiaryAudio[]>([])
  const audioInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const filesInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const recorder = useDiaryRecorder((voice) => setAudio((current) => [...current, voice]), setError)
  const draftReady = useDiaryDraft({ editing, date, title, content, audio, images }, (draft) => {
    setEditing(draft.editing); setDate(draft.date); setTitle(draft.title); setContent(draft.content)
    setAudio(draft.audio); setImages(draft.images)
  }, setError)
  const blocked = busy || recorder.active || !draftReady
  const load = () => api<Entry[]>('/api/diary').then(setItems)
  useEffect(() => { load().catch((e) => setError(e.message)) }, [])
  const reset = () => { setEditing(null); setDate(today()); setTitle(''); setContent(''); setImages([]); setAudio([]); setError('') }
  const edit = (x: Entry) => { setEditing(x); setDate(x.date); setTitle(x.title); setContent(x.content); setImages(x.images ?? []); setAudio(x.audio ?? []); setError('') }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (lock.current || recorder.active || !draftReady) return
    lock.current = true; setBusy(true); setError('')
    try {
      const body = JSON.stringify({ date, title, content, images, audio })
      const saved = await api<Entry>(editing ? `/api/diary/${editing.id}` : '/api/diary', {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body
      })
      if (!diaryAttachmentsSaved({ audio, images }, saved)) {
        // Older running servers can accept the text while silently ignoring audio.
        // Keep the draft attachments and retry against this entry after restart.
        setEditing(saved)
        await load()
        throw new Error('Сервер сохранил текст, но не подтвердил сохранение вложений. Голосовые и картинки остались в форме. Черновик с вложениями сохранён в этом браузере. Запусти обновлённый Trellis и повтори сохранение записи.')
      }
      reset(); await load()
    } catch (e) { setError((e as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  const addImages = async (files: File[]) => {
    if (lock.current || recorder.active || !draftReady || !files.length) return
    if (images.length + files.length > MAX_DIARY_IMAGES) {
      setError(`Можно добавить до ${MAX_DIARY_IMAGES} изображений.`); return
    }
    lock.current = true; setBusy(true); setError('')
    try {
      const attachments = await Promise.all(files.map(prepareDiaryImage))
      setImages((current) => [...current, ...attachments])
    } catch (e) { setError((e as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  const addAudio = async (files: File[]) => {
    if (lock.current || recorder.active || !draftReady || !files.length) return
    if (audio.length + files.length > MAX_DIARY_AUDIO) { setError(`Можно добавить до ${MAX_DIARY_AUDIO} голосовых.`); return }
    lock.current = true; setBusy(true); setError('')
    try { const voices = await Promise.all(files.map((file) => prepareDiaryAudio(file, file.name))); setAudio((current) => [...current, ...voices]) }
    catch (e) { setError((e as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  const paste = (e: ClipboardEvent<HTMLFormElement>) => {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile()).filter((file): file is File => file !== null)
    if (!files.length) return
    e.preventDefault()
    void addImages(files)
  }
  const remove = async (x: Entry) => {
    if (lock.current || recorder.active || !confirm('Удалить эту запись из дневника?')) return
    lock.current = true; setBusy(true); setError('')
    try {
      await api(`/api/diary/${x.id}`, { method: 'DELETE' })
      if (editing?.id === x.id) reset()
      await load()
    } catch (e) { setError((e as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  return <main>
    <header><div><div className="eyebrow">JOURNAL</div><h1>Дневник</h1><p className="muted">Отдельное место для мыслей, событий и состояния по дням.</p></div><button disabled={blocked} onClick={reset}>+ Запись</button></header>
    {error && <div className="message error">{error}</div>}
    <div className="diary-layout">
      <form className="card diary-form" onSubmit={submit} onPaste={paste} aria-busy={blocked}>
        <fieldset disabled={blocked} className="diary-fields">
        <label>Дата<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label>Заголовок<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Необязательно" /></label>
        <label>Запись<textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Что произошло? Что чувствуешь? Что важно запомнить?" required={!images.length && !audio.length} maxLength={500000} /></label>
        <div className="diary-attachments">
          <span>Фото и картинки</span>
          <input ref={filesInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => { void addImages(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          <button type="button" className="secondary" disabled={images.length >= MAX_DIARY_IMAGES} onClick={() => filesInput.current?.click()}>Добавить изображения</button>
          <small className="muted">Выбери файлы или вставь картинку через ⌘V / Ctrl+V в поле записи. До 8 изображений; большие фото уменьшаются.</small>
          {images.length > 0 && <div className="diary-images diary-image-previews">{images.map((image) => <figure key={image.id}>
            <img src={image.dataUrl} alt={image.name} />
            <button type="button" className="icon-button delete" aria-label={`Удалить изображение ${image.name}`} onClick={() => setImages((current) => current.filter((x) => x.id !== image.id))}>×</button>
          </figure>)}</div>}
        </div>
        <div className="diary-attachments">
          <span>Голосовые сообщения{audio.length > 0 ? ` · ${audio.length} прикреплено` : ''}</span>
          <input ref={audioInput} type="file" accept="audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav,audio/x-wav,.m4a" multiple hidden onChange={(e) => { void addAudio(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          <button type="button" className="secondary" disabled={audio.length >= MAX_DIARY_AUDIO} onClick={() => { setError(''); void recorder.start() }}>Записать голосовое</button>
          <button type="button" className="secondary" disabled={audio.length >= MAX_DIARY_AUDIO} onClick={() => audioInput.current?.click()}>Загрузить аудиофайл</button>
          <small className="muted">До 3 голосовых по 5 МБ. Запись с микрофона — до 10 минут.</small>
          {audio.map((voice) => <div className="diary-audio" key={voice.id}><small>{voice.name} · будет сохранено с записью</small><audio controls preload="metadata" src={voice.dataUrl} aria-label={voice.name} /><button type="button" className="secondary" onClick={() => setAudio((current) => current.filter((x) => x.id !== voice.id))}>Удалить голосовое</button><a href={voice.dataUrl} download={`${voice.name.replace(/[\/:*?"<>|]/g, '-')}.${voice.dataUrl.startsWith('data:audio/mp4') ? 'm4a' : voice.dataUrl.slice(11, voice.dataUrl.indexOf(';'))}`}>Скачать аудио</a></div>)}
        </div>
        <div className="form-actions"><button>{editing ? 'Сохранить запись' : 'Добавить запись'}{audio.length > 0 ? ` с ${audio.length} голосовыми` : ''}</button>{editing && <button type="button" className="secondary" onClick={reset}>Отмена</button>}</div>
        </fieldset>
        {recorder.active && <div className="diary-attachments" role="status">
          <span>{recorder.recording ? `Запись: ${Math.floor(recorder.seconds / 60)}:${String(recorder.seconds % 60).padStart(2, '0')}` : 'Подготовка голосового…'}</span>
          {recorder.recording && <button type="button" onClick={() => recorder.stop()}>Остановить и добавить</button>}
          <button type="button" className="secondary" onClick={() => recorder.stop(true)}>Отменить запись</button>
        </div>}
      </form>
      <section className="diary-feed">
        {items.map((x) => <article className="card diary-entry" key={x.id}>
          <div className="entry-head"><div><div className="eyebrow">{new Date(x.date + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>{x.title && <h2>{x.title}</h2>}</div><div><button disabled={blocked} className="icon-button" onClick={() => edit(x)}>✎</button><button disabled={blocked} className="icon-button delete" onClick={() => remove(x)}>×</button></div></div>
          {x.content && <p>{x.content}</p>}
          {x.audio?.map((voice) => <div className="diary-audio" key={voice.id}><small>Голосовое · {voice.name}</small><audio controls preload="none" src={voice.dataUrl} aria-label={voice.name} /></div>)}
          {!!x.images?.length && <div className="diary-images">{x.images.map((image) => <img key={image.id} src={image.dataUrl} alt={image.name} loading="lazy" />)}</div>}
        </article>)}
        {!items.length && <div className="card muted">Записей пока нет.</div>}
      </section>
    </div>
  </main>
}
