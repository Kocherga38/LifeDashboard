import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api } from './api'
import './personal.css'

type Folder = { id: string; name: string; parentId: string | null }
type Note = { id: string; folderId: string | null; title: string; content: string; updatedAt: string }

export default function Notes() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [folderId, setFolderId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Note | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const load = async () => {
    const [f, n] = await Promise.all([api<Folder[]>('/api/note-folders'), api<Note[]>('/api/notes')])
    setFolders(f); setNotes(n)
  }
  useEffect(() => { load().catch((e) => setError(e.message)) }, [])
  const visible = useMemo(() => notes.filter((n) => n.folderId === folderId), [notes, folderId])
  const choose = (n: Note) => { setSelected(n); setTitle(n.title); setContent(n.content) }
  const fresh = () => { setSelected(null); setTitle(''); setContent('') }
  const save = async (e?: FormEvent) => {
    e?.preventDefault(); setError('')
    try {
      const body = JSON.stringify({ title, content, folderId })
      const n = selected
        ? await api<Note>(`/api/notes/${selected.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
        : await api<Note>('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      await load(); choose(n)
    } catch (e) { setError((e as Error).message) }
  }
  const addFolder = async () => {
    const name = prompt('Название папки')?.trim(); if (!name) return
    try { await api('/api/note-folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parentId: folderId }) }); await load() }
    catch (e) { setError((e as Error).message) }
  }
  const renameFolder = async (f: Folder) => {
    const name = prompt('Новое название папки', f.name)?.trim(); if (!name) return
    try { await api(`/api/note-folders/${f.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); await load() }
    catch (e) { setError((e as Error).message) }
  }
  const deleteFolder = async (f: Folder) => {
    if (!confirm(`Удалить папку «${f.name}» вместе со всеми вложенными папками и заметками?`)) return
    try { await api(`/api/note-folders/${f.id}`, { method: 'DELETE' }); setFolderId(null); fresh(); await load() }
    catch (e) { setError((e as Error).message) }
  }
  const deleteNote = async () => {
    if (!selected || !confirm(`Удалить заметку «${selected.title}»?`)) return
    await api(`/api/notes/${selected.id}`, { method: 'DELETE' }); fresh(); await load()
  }
  const children = (parentId: string | null, depth = 0): ReactNode[] => folders.filter((f) => f.parentId === parentId).flatMap((f) => [
    <div className={`folder-row ${folderId === f.id ? 'active' : ''}`} key={f.id} style={{ paddingLeft: 12 + depth * 16 }}>
      <button className="folder-open" onClick={() => { setFolderId(f.id); fresh() }}>▸ {f.name}</button>
      <button className="mini" onClick={() => renameFolder(f)}>✎</button><button className="mini delete" onClick={() => deleteFolder(f)}>×</button>
    </div>,
    ...children(f.id, depth + 1)
  ])
  return <main>
    <header><div><div className="eyebrow">KNOWLEDGE</div><h1>Заметки</h1><p className="muted">Свободные заметки с папками и вложенной структурой.</p></div><button onClick={fresh}>+ Заметка</button></header>
    {error && <div className="message error">{error}</div>}
    <div className="notes-layout">
      <aside className="card folder-pane">
        <div className="pane-title"><strong>Папки</strong><button className="mini" onClick={addFolder}>+</button></div>
        <button className={`root-folder ${folderId === null ? 'active' : ''}`} onClick={() => { setFolderId(null); fresh() }}>Все без папки</button>
        {children(null)}
      </aside>
      <section className="card note-list"><div className="pane-title"><strong>Заметки</strong><span className="muted">{visible.length}</span></div>
        {visible.length ? visible.map((n) => <button className={`note-item ${selected?.id === n.id ? 'active' : ''}`} key={n.id} onClick={() => choose(n)}><strong>{n.title}</strong><small>{n.content.slice(0, 90) || 'Пустая заметка'}</small></button>) : <p className="muted empty">Здесь пока пусто.</p>}
      </section>
      <form className="card note-editor" onSubmit={save}>
        <input className="note-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название заметки" maxLength={200} required />
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Пиши сюда…" />
        <div className="editor-actions"><button type="submit">{selected ? 'Сохранить' : 'Создать'}</button>{selected && <button type="button" className="secondary delete" onClick={deleteNote}>Удалить</button>}</div>
      </form>
    </div>
  </main>
}
