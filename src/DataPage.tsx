import { useEffect, useState } from 'react'
import { api } from './api'

type Entry = {
  id: string | number; recorded_at: string; table_name: string; record_key: Record<string, unknown>
  action: string; title: string
}
type Details = { before_data: unknown; after_data: unknown }
type Page = { entries: Entry[]; nextBefore: string | null }
const actions: Record<string, string> = {
  snapshot: 'Начальный снимок', create: 'Создано', update: 'Изменено', delete: 'Удалено',
  navigate: 'Открыт раздел', export: 'Выгрузка данных'
}
const tables: Record<string, string> = {
  expenses: 'Операция', operation_categories: 'Категория', operation_templates: 'Шаблон операции',
  budgets: 'Бюджет', journal_entries: 'Журнал', sleep_entries: 'Сон', tasks: 'Задача',
  task_occurrences: 'Повторение задачи', note_folders: 'Папка заметок', notes: 'Заметка',
  diary_entries: 'Дневник', flashcards: 'Карточка', habits: 'Привычка', habit_marks: 'Отметка привычки',
  personal_goals: 'Цель', monthly_goals: 'Цель месяца', app_settings: 'Настройка',
  calendar_events: 'Событие', planned_shifts: 'План смены', meal_notes: 'Заметка о питании',
  speaking_sessions: 'Разговор на английском', weekly_reflections: 'Итог недели', app: 'Приложение'
}
const sections: Record<string, string> = {
  today: 'Сегодня', weekly: 'Обзор недели', goals: 'Цели', operations: 'Операции', analytics: 'Аналитика',
  calendar: 'Календарь', notes: 'Заметки', diary: 'Дневник', flashcards: 'Карточки', habits: 'Трекер',
  shifts: 'Смены', weights: 'Вес', sleep: 'Сон', measurements: 'Замеры', meals: 'Питание',
  products: 'Продукты', workouts: 'Тренировки', data: 'Данные'
}

function HistoryEntry({ entry }: { entry: Entry }) {
  const [details, setDetails] = useState<Details | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function showDetails(open: boolean) {
    if (!open || details || loading) return
    setError('')
    setLoading(true)
    try { setDetails(await api<Details>(`/api/activity/${entry.id}`)) }
    catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }
  const title = entry.action === 'navigate' ? (sections[entry.title] ?? entry.title) : entry.title
  return <article className="history-entry">
    <p><strong>{actions[entry.action] ?? entry.action}</strong> · {tables[entry.table_name] ?? entry.table_name}{title && ` · ${title}`}</p>
    <small className="muted">{new Date(entry.recorded_at).toLocaleString('ru-RU')} · № {entry.id}</small>
    <details onToggle={(event) => void showDetails(event.currentTarget.open)}>
      <summary>До и после</summary>
      {loading && <p className="muted">Загружаем запись…</p>}
      {error && <p role="alert">{error} <button className="secondary" onClick={() => void showDetails(true)}>Повторить</button></p>}
      {details && <div className="history-versions">
        <div><h3>До действия</h3><pre>{details.before_data == null ? 'Нет предыдущего состояния' : JSON.stringify(details.before_data, null, 2)}</pre></div>
        <div><h3>После действия</h3><pre>{details.after_data == null ? 'Запись удалена' : JSON.stringify(details.after_data, null, 2)}</pre></div>
      </div>}
    </details>
  </article>
}

export default function DataPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function load(before?: string) {
    setBusy(true)
    setError('')
    try {
      const page = await api<Page>(`/api/activity${before ? `?before=${before}` : ''}`)
      setEntries((previous) => before ? [...previous, ...page.entries] : page.entries)
      setNextBefore(page.nextBefore)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])
  return <main>
    <header><div>
      <p className="eyebrow">TRELLIS / ТВОИ ДАННЫЕ</p>
      <h1>Данные</h1>
      <p className="muted">Записи, резервная копия и история изменений.</p>
    </div></header>
    <section className="card">
      <h2>Резервная копия</h2>
      <p className="muted">Все разделы, настройки и полная история изменений, включая содержимое удалённых записей, в одном JSON для анализа.</p>
      <a className="download-button" href="/api/export">Скачать данные JSON</a>
    </section>
    <section className="card history-panel">
      <div className="section-heading"><h2>История действий</h2><button className="secondary" disabled={busy} onClick={() => void load()}>Обновить</button></div>
      <p className="muted">Сохраняются создание, редактирование и удаление во всех разделах, выполнение и перенос задач, отметки привычек, повторения карточек, настройки, открытия разделов и выгрузки. Удаление записи не удаляет её историю.</p>
      <p className="muted">Начальный снимок — состояние записей при включении журнала. Более ранние изменения неизвестны. Ввод без сохранения, поиск и отдельные клики не записываются.</p>
      {error && <p role="alert">{error}</p>}
      {entries.map((entry) => <HistoryEntry key={entry.id} entry={entry} />)}
      {!entries.length && !busy && !error && <p className="muted">Действий пока нет.</p>}
      {busy && <p className="muted">Загружаем историю…</p>}
      {nextBefore && <button className="secondary" disabled={busy} onClick={() => void load(nextBefore)}>Показать более ранние</button>}
    </section>
  </main>
}
