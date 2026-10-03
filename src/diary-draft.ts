import { useEffect, useRef, useState } from 'react'
import type { DiaryAudio } from '../shared/diary-audio'
import type { DiaryImage } from '../shared/diary'

export type DiaryDraft = {
  editing: { id: string; date: string; title: string; content: string; createdAt: string } | null
  date: string; title: string; content: string; audio: DiaryAudio[]; images: DiaryImage[]
}
const key = 'current'
const database = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('trellis-diary-drafts', 1)
  request.onupgradeneeded = () => request.result.createObjectStore('drafts')
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
async function readDraft(): Promise<DiaryDraft | undefined> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}
async function writeDraft(draft: DiaryDraft | null) {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite')
      if (draft) transaction.objectStore('drafts').put(draft, key)
      else transaction.objectStore('drafts').delete(key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
}
export function useDiaryDraft(draft: DiaryDraft, restore: (draft: DiaryDraft) => void, onError: (message: string) => void) {
  const [ready, setReady] = useState(false)
  const initialRestore = useRef(restore)
  const reportError = useRef(onError)
  const writes = useRef(Promise.resolve())
  useEffect(() => {
    let alive = true
    readDraft().then((saved) => { if (alive && saved) initialRestore.current(saved) })
      .catch(() => { if (alive) reportError.current('Не удалось восстановить черновик дневника.') })
      .finally(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [])
  useEffect(() => {
    if (!ready) return
    const snapshot = draft.content || draft.title || draft.audio.length || draft.images.length || draft.editing ? draft : null
    writes.current = writes.current.then(() => writeDraft(snapshot)).catch(() => {
      reportError.current('Не удалось сохранить черновик в браузере. Сохрани запись перед обновлением страницы.')
    })
  }, [ready, draft.date, draft.title, draft.content, draft.editing, draft.audio, draft.images])
  return ready
}
