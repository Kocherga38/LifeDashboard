import { useState } from 'react'
import type { FormEvent } from 'react'

type PrivateEntry = { id: string; date: string; category: string; count: number; note: string }
type Vault = { version: 1; salt: string; iv: string; ciphertext: string }
const STORAGE = 'trellis-private-vault-v1'
const iterations = 310000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function b64(bytes: Uint8Array): string {
  let s = ''
  for (const byte of bytes) s += String.fromCharCode(byte)
  return btoa(s)
}
function unb64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0))
}
function random(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}
async function derive(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const input = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    input,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}
async function encrypt(entries: PrivateEntry[], password: string): Promise<Vault> {
  const salt = random(16)
  const iv = random(12)
  const key = await derive(password, salt)
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    encoder.encode(JSON.stringify(entries))
  )
  return { version: 1, salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(encrypted)) }
}
async function decrypt(vault: Vault, password: string): Promise<PrivateEntry[]> {
  if (vault.version !== 1 || !vault.salt || !vault.iv || !vault.ciphertext) throw new Error('Неподдерживаемый формат хранилища')
  const key = await derive(password, unb64(vault.salt))
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(vault.iv) as BufferSource },
    key,
    unb64(vault.ciphertext) as BufferSource
  )
  const rows: unknown = JSON.parse(decoder.decode(clear))
  if (!Array.isArray(rows)) throw new Error('Неверный формат записей')
  return rows as PrivateEntry[]
}
function stored(): Vault | null {
  try {
    const v = localStorage.getItem(STORAGE)
    return v ? JSON.parse(v) as Vault : null
  } catch { return null }
}
function localDate(): string {
  const date = new Date()
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

export default function PrivateVault() {
  const [exists, setExists] = useState(() => Boolean(stored()))
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [entries, setEntries] = useState<PrivateEntry[]>([])
  const [date, setDate] = useState(localDate)
  const [category, setCategory] = useState('Мастурбация')
  const [count, setCount] = useState('1')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [showNotes, setShowNotes] = useState(false)
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date))
  const thisMonth = localDate().slice(0, 7)
  const monthly = entries.filter(e => e.date.startsWith(thisMonth))
  const total = monthly.reduce((sum, e) => sum + e.count, 0)

  async function open(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!crypto?.subtle) { setError('Для шифрования нужен защищённый контекст: localhost или HTTPS.'); return }
    if (!password) return
    if (!exists && password.length < 12) { setError('Укажи пароль длиной хотя бы 12 символов.'); return }
    if (!exists && password !== confirmation) { setError('Пароли не совпадают.'); return }
    setBusy(true)
    try {
      if (exists) {
        const vault = stored()
        if (!vault) throw new Error('Хранилище не найдено')
        setEntries(await decrypt(vault, password))
      } else {
        localStorage.setItem(STORAGE, JSON.stringify(await encrypt([], password)))
        setEntries([])
        setExists(true)
      }
      setUnlocked(true)
      setConfirmation('')
    } catch {
      setError('Не удалось открыть хранилище: неверный пароль или повреждённые данные.')
    } finally { setBusy(false) }
  }
  async function save(next: PrivateEntry[]) {
    if (!password) throw new Error('Сначала открой хранилище')
    // Never update the visible entries unless persistence succeeded.
    localStorage.setItem(STORAGE, JSON.stringify(await encrypt(next, password)))
    setEntries(next)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const number = Number(count)
    if (!date || !Number.isInteger(number) || number < 1 || number > 1000) {
      setError('Выбери дату и целое количество от 1 до 1000.')
      return
    }
    const entry: PrivateEntry = { id: editing ?? crypto.randomUUID(), date, category, count: number, note: note.trim() }
    setBusy(true)
    try {
      await save(editing ? entries.map(e => e.id === editing ? entry : e) : [...entries, entry])
      setEditing(null); setNote(''); setCount('1')
    } catch { setError('Не удалось сохранить зашифрованную запись. Проверь свободное место в браузере.') }
    finally { setBusy(false) }
  }
  async function remove(id: string) {
    if (!window.confirm('Удалить эту запись без возможности восстановления?')) return
    setBusy(true)
    try { await save(entries.filter(e => e.id !== id)) }
    catch { setError('Не удалось удалить запись.') }
    finally { setBusy(false) }
  }
  function edit(entry: PrivateEntry) {
    setEditing(entry.id); setDate(entry.date); setCategory(entry.category)
    setCount(String(entry.count)); setNote(entry.note)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function lock() {
    setUnlocked(false); setEntries([]); setPassword(''); setNote(''); setEditing(null); setShowNotes(false)
  }
  function backup() {
    const raw = localStorage.getItem(STORAGE)
    if (!raw) return
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
    link.download = 'trellis-private-encrypted.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }
  async function restore(file: File | undefined) {
    if (!file || unlocked) return
    setError('')
    try {
      const text = await file.text()
      const payload = JSON.parse(text) as Vault
      if (payload.version !== 1 || !payload.salt || !payload.iv || !payload.ciphertext) throw Error('invalid')
      if (exists && !window.confirm('Заменить текущее приватное хранилище резервной копией? Текущие записи будут потеряны.')) return
      localStorage.setItem(STORAGE, JSON.stringify(payload))
      setExists(true)
      setPassword('')
      setConfirmation('')
    } catch { setError('Это не зашифрованная резервная копия Trellis.') }
  }

  return <main className="private-vault">
    <div className="private-vault-heading">
      <div>
        <p className="muted">ЛИЧНОЕ · ШИФРОВАНИЕ</p>
        <h1>Приватное</h1>
        <p className="muted">Отдельные интимные записи, доступные только после ввода пароля.</p>
      </div>
      {unlocked && <button type="button" onClick={lock}>Закрыть хранилище</button>}
    </div>
    {!unlocked ? <section className="card private-vault-card">
      <h2>{exists ? 'Открыть хранилище' : 'Создать приватное хранилище'}</h2>
      <p className="muted">Записи шифруются в этом браузере (AES-GCM) и не передаются в API Trellis, историю действий и общий JSON-экспорт. Они не синхронизируются с другими устройствами.</p>
      <form onSubmit={e => void open(e)} className="private-vault-form">
        <label>Пароль<input type="password" autoComplete={exists ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {!exists && <label>Повтори пароль<input type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required /></label>}
        <button disabled={busy} type="submit">{busy ? 'Подожди…' : exists ? 'Открыть' : 'Создать'}</button>
      </form>
      <p className="muted">Пароль не сохраняется. Если забудешь его, восстановить записи невозможно. Очистка данных браузера также удалит хранилище, поэтому сохрани зашифрованную резервную копию.</p>
      {exists && <button type="button" onClick={backup}>Скачать зашифрованную копию</button>}
      <label className="private-vault-restore">Восстановить зашифрованную копию
        <input type="file" accept=".json,application/json" onChange={e => void restore(e.target.files?.[0])} />
      </label>
      {error && <p role="alert">{error}</p>}
    </section> : <>
      <section className="card private-vault-card">
        <h2>{editing ? 'Изменить запись' : 'Новая запись'}</h2>
        <form onSubmit={e => void submit(e)} className="private-vault-form">
          <label>Дата<input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label>
          <label>Тип<select value={category} onChange={e => setCategory(e.target.value)}>
            <option>Мастурбация</option><option>Секс</option><option>Другое</option>
          </select></label>
          <label>Количество<input type="number" min="1" max="1000" step="1" value={count} onChange={e => setCount(e.target.value)} required /></label>
          <label>Комментарий (необязательно)<textarea value={note} onChange={e => setNote(e.target.value)} rows={2} /></label>
          <div className="private-vault-actions"><button disabled={busy} type="submit">{busy ? 'Сохраняем…' : 'Сохранить'}</button>
            {editing && <button type="button" onClick={() => { setEditing(null); setNote(''); setCount('1') }}>Отмена</button>}
          </div>
        </form>
        {error && <p role="alert">{error}</p>}
      </section>
      <section className="card private-vault-card">
        <h2>Этот месяц</h2>
        <p>{monthly.length} записей · {total} всего отмеченных событий</p>
      </section>
      <section className="card private-vault-card">
        <div className="private-vault-heading"><h2>История</h2><button type="button" onClick={() => setShowNotes(v => !v)}>{showNotes ? 'Скрыть комментарии' : 'Показать комментарии'}</button></div>
        {sorted.length === 0 ? <p className="muted">Записей пока нет.</p> : <div className="private-vault-list">
          {sorted.map(e => <div className="private-vault-entry" key={e.id}>
            <div><strong>{e.date} · {e.category} · {e.count}</strong>{showNotes && e.note && <p>{e.note}</p>}</div>
            <div className="private-vault-actions"><button type="button" onClick={() => edit(e)}>Изменить</button><button type="button" disabled={busy} onClick={() => void remove(e.id)}>Удалить</button></div>
          </div>)}
        </div>}
        <button type="button" onClick={backup}>Скачать зашифрованную резервную копию</button>
      </section>
    </>}
  </main>
}
