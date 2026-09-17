import { lazy, Suspense, useState } from 'react'
import Operations from './Operations'
import DataPage from './DataPage'
import Calendar from './Calendar'
import Notes from './Notes'
import Diary from './Diary'
import Flashcards from './Flashcards'
import Habits from './Habits'
import Today from './Today'
import WeeklyReview from './WeeklyReview'
import ErrorBoundary from './ErrorBoundary'
import type { Kind } from '../shared/journals'
import './analytics.css'
import './journals.css'
const Analytics = lazy(() => import('./Analytics'))
const Journal = lazy(() => import('./Journal'))
type Tab = 'today' | 'weekly' | 'operations' | 'analytics' | 'calendar' | 'notes' | 'diary' | 'flashcards' | 'habits' | 'data' | Kind
const tabs: { key: Tab; label: string; icon: string }[] = [
  { key: 'today', label: 'Сегодня', icon: '●' },
  { key: 'weekly', label: 'Обзор недели', icon: '◎' },
  { key: 'operations', label: 'Операции', icon: '↗' },
  { key: 'analytics', label: 'Аналитика', icon: '◷' },
  { key: 'calendar', label: 'Календарь', icon: '□' },
  { key: 'notes', label: 'Заметки', icon: '≡' },
  { key: 'diary', label: 'Дневник', icon: '✦' },
  { key: 'flashcards', label: 'Карточки', icon: '◫' },
  { key: 'habits', label: 'Трекер', icon: '✓' },
  { key: 'shifts', label: 'Смены', icon: '▦' },
  { key: 'weights', label: 'Вес', icon: '↝' },
  { key: 'measurements', label: 'Замеры', icon: '↔' },
  { key: 'meals', label: 'Питание', icon: '◒' },
  { key: 'products', label: 'Продукты', icon: '▤' },
  { key: 'workouts', label: 'Тренировки', icon: '⌁' },
  { key: 'data', label: 'Данные', icon: '⇣' }
]
export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          LIFE<span> / </span>SYSTEM<small>Твоя жизнь в деталях</small>
        </div>
        <nav aria-label="Разделы">
          {tabs.map((item) => (
            <button
              key={item.key}
              className={tab === item.key ? 'selected' : ''}
              aria-current={tab === item.key ? 'page' : undefined}
              onClick={() => setTab(item.key)}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" />
          Локально на твоём Mac<small>Версия 1.0 · PostgreSQL</small>
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
              <Today onNavigate={(next) => setTab(next)} />
            ) : tab === 'weekly' ? (
              <WeeklyReview />
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
