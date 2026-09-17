import { lazy, Suspense, useState } from 'react'
import Operations from './Operations'
import DataPage from './DataPage'
import Calendar from './Calendar'
import ErrorBoundary from './ErrorBoundary'
import type { Kind } from '../shared/journals'
import './analytics.css'
import './journals.css'
const Analytics = lazy(() => import('./Analytics'))
const Journal = lazy(() => import('./Journal'))
type Tab = 'operations' | 'analytics' | 'calendar' | 'data' | Kind
const tabs: { key: Tab; label: string; icon: string }[] = [
  { key: 'operations', label: 'Операции', icon: '↗' },
  { key: 'analytics', label: 'Аналитика', icon: '◷' },
  { key: 'calendar', label: 'Календарь', icon: '□' },
  { key: 'shifts', label: 'Смены', icon: '▦' },
  { key: 'weights', label: 'Вес', icon: '↝' },
  { key: 'measurements', label: 'Замеры', icon: '↔' },
  { key: 'meals', label: 'Питание', icon: '◒' },
  { key: 'products', label: 'Продукты', icon: '▤' },
  { key: 'workouts', label: 'Тренировки', icon: '⌁' },
  { key: 'data', label: 'Данные', icon: '⇣' }
]
export default function App() {
  const [tab, setTab] = useState<Tab>('operations')
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
            {tab === 'operations' ? (
              <Operations />
            ) : tab === 'analytics' ? (
              <Analytics />
            ) : tab === 'calendar' ? (
              <Calendar />
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
