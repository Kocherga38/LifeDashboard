import { useRef, useState } from 'react'
import { api } from './api'
export const send = <T,>(path: string, method: string, body?: unknown) => api<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
export function useHouseholdAction() {
  const lock = useRef(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function run(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await action() } catch (e) { setError((e as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  return { busy, error, run }
}
export function HouseholdStatus({ loading, error }: { loading: boolean; error: string }) {
  return <>{error && <div className="message error" role="alert">{error}</div>}{loading && <p className="muted" role="status">Загружаем записи…</p>}</>
}
