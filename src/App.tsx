import { lazy, Suspense, useEffect, useState } from 'react'
import type { DragEvent } from 'react'
import Operations from './Operations'
import DataPage from './DataPage'
import Calendar from './Calendar'
import Notes from './Notes'
import Diary from './Diary'
import Flashcards from './Flashcards'
import Habits from './Habits'
import Sleep from './Sleep'
import Today from './Today'
import WeeklyReview from './WeeklyReview'
import Goals from './Goals'
import ErrorBoundary from './ErrorBoundary'
import { api, today } from './api'
import type { Kind } from '../shared/journals'
import './analytics.css'
import './journals.css'
const Analytics = lazy(() => import('./Analytics'))
const Journal = lazy(() => import('./Journal'))
type Tab = 'today' | 'weekly' | 'goals' | 'operations' | 'analytics' | 'calendar' | 'notes' | 'diary' | 'flashcards' | 'habits' | 'sleep' | 'data' | Kind
type TabItem = { key: Tab; label: string; icon: string }
const tabs: TabItem[] = [
  { key: 'today', label: 'Сегодня', icon: '●' },
  { key: 'weekly', label: 'Обзор недели', icon: '◎' },
  { key: 'goals', label: 'Цели', icon: '✳' },
  { key: 'operations', label: 'Операции', icon: '↗' },
  { key: 'analytics', label: 'Аналитика', icon: '◷' },
  { key: 'calendar', label: 'Календарь', icon: '□' },
  { key: 'notes', label: 'Заметки', icon: '≡' },
  { key: 'diary', label: 'Дневник', icon: '✦' },
  { key: 'flashcards', label: 'Карточки', icon: '◫' },
  { key: 'habits', label: 'Трекер', icon: '✓' },
  { key: 'shifts', label: 'Смены', icon: '▦' },
  { key: 'weights', label: 'Вес', icon: '↝' },
  { key: 'sleep', label: 'Сон', icon: '☾' },
  { key: 'measurements', label: 'Замеры', icon: '↔' },
  { key: 'meals', label: 'Питание', icon: '◒' },
  { key: 'products', label: 'Продукты', icon: '▤' },
  { key: 'workouts', label: 'Тренировки', icon: '⌁' },
  { key: 'data', label: 'Данные', icon: '⇣' }
]

function tabsInOrder(order: string[]) {
  const byKey = new Map<Tab, TabItem>(tabs.map((item) => [item.key, item]))
  const ordered: TabItem[] = []
  for (const key of order) {
    const item = byKey.get(key as Tab)
    if (!item || ordered.some((entry) => entry.key === item.key)) continue
    ordered.push(item)
  }
  for (const item of tabs) if (!ordered.some((entry) => entry.key === item.key)) ordered.push(item)
  return ordered
}

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  const [goalMonth, setGoalMonth] = useState(() => today().slice(0, 7))
  const [orderedTabs, setOrderedTabs] = useState(tabs)
  const [ordering, setOrdering] = useState(false)
  const [draggedTab, setDraggedTab] = useState<Tab | null>(null)
  const [orderError, setOrderError] = useState('')

  useEffect(() => {
    let alive = true
    api<{ order: string[] }>('/api/sidebar-order')
      .then(({ order }) => alive && setOrderedTabs(tabsInOrder(order)))
      .catch((error) => alive && setOrderError(error.message))
    return () => { alive = false }
  }, [])

  async function dropTab(event: DragEvent, target: Tab) {
    event.preventDefault()
    if (!draggedTab || draggedTab === target) return
    const before = orderedTabs
    const next = [...orderedTabs]
    const fromIndex = next.findIndex((item) => item.key === draggedTab)
    const targetIndex = next.findIndex((item) => item.key === target)
    if (fromIndex < 0 || targetIndex < 0) return
    const [moved] = next.splice(fromIndex, 1)
    next.splice(targetIndex, 0, moved)
    setOrderedTabs(next)
    setDraggedTab(null)
    setOrderError('')
    try {
      await api('/api/sidebar-order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: next.map((item) => item.key) })
      })
    } catch (error) {
      setOrderedTabs(before)
      setOrderError((error as Error).message)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-symbol" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <path d="M9 38V10M24 38V10M39 38V10M9 16C15 16 18 22 24 22S33 16 39 16M9 31C15 31 18 25 24 25S33 31 39 31" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="9" cy="10" r="3" fill="currentColor" /><circle cx="24" cy="10" r="3" fill="currentColor" /><circle cx="39" cy="10" r="3" fill="currentColor" />
            </svg>
          </span>
          <span className="brand-copy"><strong>Trellis</strong><small>Личная система</small></span>
        </div>
        <div className="sidebar-section-label">ПРОСТРАНСТВО <span>01 / {tabs.length}</span></div>
        <button
          className={`sidebar-order-toggle ${ordering ? 'active' : ''}`}
          onClick={() => { setOrdering((value) => !value); setDraggedTab(null) }}
        >
          {ordering ? 'Готово' : 'Настроить порядок'}
        </button>
        {orderError && <small className="sidebar-order-error" title={orderError}>Порядок не сохранился</small>}
        <nav aria-label="Разделы" className={ordering ? 'ordering' : ''}>
          {orderedTabs.map((item) => (
            <div
              key={item.key}
              className={`sidebar-nav-item ${draggedTab === item.key ? 'dragging' : ''}`}
              draggable={ordering}
              onDragStart={(event) => {
                setDraggedTab(item.key)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', item.key)
              }}
              onDragOver={(event) => {
                if (ordering && draggedTab) event.preventDefault()
              }}
              onDrop={(event) => void dropTab(event, item.key)}
              onDragEnd={() => setDraggedTab(null)}
            >
              <button
                className={tab === item.key ? 'selected' : ''}
                aria-current={tab === item.key ? 'page' : undefined}
                onClick={() => { if (item.key === 'goals') setGoalMonth(today().slice(0, 7)); setTab(item.key) }}
              >
                <span>{item.icon}</span>
                {item.label}
              </button>
              {ordering && <span className="sidebar-drag-handle" title="Перетащи раздел">⋮⋮</span>}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-footer-icon" aria-hidden="true">↗</div>
          <div><span className="status-dot" />Твоё пространство<small>Данные хранятся локально</small></div>
        </div>
      </aside>
      <div className="workspace">
        <ErrorBoundary key={tab}>
          <Suspense
            fallback={
              <main>
                <p className="muted">Открываем раздел…</p>
              </main>
            }
          >
            {tab === 'today' ? (
              <Today onNavigate={(next) => { if (next === 'goals') setGoalMonth(today().slice(0, 7)); setTab(next) }} />
            ) : tab === 'weekly' ? (
              <WeeklyReview onNavigate={(month) => { setGoalMonth(month); setTab('goals') }} />
            ) : tab === 'goals' ? (
              <Goals initialMonth={goalMonth} />
            ) : tab === 'operations' ? (
              <Operations />
            ) : tab === 'analytics' ? (
              <Analytics />
            ) : tab === 'calendar' ? (
              <Calendar />
            ) : tab === 'notes' ? (
              <Notes />
            ) : tab === 'diary' ? (
              <Diary />
            ) : tab === 'flashcards' ? (
              <Flashcards />
            ) : tab === 'habits' ? (
              <Habits />
            ) : tab === 'sleep' ? (
              <Sleep />
            ) : tab === 'data' ? (
              <DataPage />
            ) : (
              <Journal key={tab} kind={tab} />
            )}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  )
}
