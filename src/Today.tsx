import { useEffect, useMemo, useState } from 'react'
import { api, money, today } from './api'
import './overview.css'

type Task = { id: string; title: string; date: string; occurrenceDate?: string; completed: boolean; color: string }
type Habit = { id: string; name: string }
type Mark = { habitId: string; date: string }
type Flashcard = { id: string; dueDate: string }
type Expense = { id: string; amount: number; type: 'expense' | 'income'; date: string }
type Entry = Record<string, any> & { id: string; date?: string }
type Diary = { id: string; date: string; title: string; content: string }
type Nav = 'calendar' | 'habits' | 'flashcards' | 'diary' | 'operations' | 'shifts' | 'weights' | 'workouts'

export default function Today({ onNavigate }: { onNavigate: (tab: Nav) => void }) {
  const date = today()
  const [tasks, setTasks] = useState<Task[]>([])
  const [habits, setHabits] = useState<Habit[]>([])
  const [marks, setMarks] = useState<Mark[]>([])
  const [cards, setCards] = useState<Flashcard[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [shifts, setShifts] = useState<Entry[]>([])
  const [weights, setWeights] = useState<Entry[]>([])
  const [workouts, setWorkouts] = useState<Entry[]>([])
  const [diary, setDiary] = useState<Diary[]>([])
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      const [t, h, m, c, e, s, w, wo, d] = await Promise.all([
        api<Task[]>(`/api/tasks?from=${date}&to=${date}`),
        api<Habit[]>('/api/habits'),
        api<Mark[]>(`/api/habit-marks?from=${date}&to=${date}`),
        api<Flashcard[]>('/api/flashcards'),
        api<Expense[]>('/api/expenses'),
        api<Entry[]>('/api/journal/shifts'),
        api<Entry[]>('/api/journal/weights'),
        api<Entry[]>('/api/journal/workouts'),
        api<Diary[]>('/api/diary')
      ])
      setTasks(t); setHabits(h); setMarks(m); setCards(c); setExpenses(e); setShifts(s); setWeights(w); setWorkouts(wo); setDiary(d)
    } catch (e) { setError((e as Error).message) }
  }

  useEffect(() => { load() }, [date])

  const marked = useMemo(() => new Set(marks.map((m) => m.habitId)), [marks])
  const completedTasks = tasks.filter((t) => t.completed).length
  const dueCards = cards.filter((c) => c.dueDate <= date).length
  const todayOps = expenses.filter((x) => x.date === date)
  const spent = todayOps.filter((x) => x.type === 'expense').reduce((s, x) => s + Number(x.amount), 0)
  const earned = todayOps.filter((x) => x.type === 'income').reduce((s, x) => s + Number(x.amount), 0)
  const todayShift = shifts.filter((x) => x.date === date)
  const todayWorkout = workouts.filter((x) => x.date === date)
  const todayWeight = weights.find((x) => x.date === date)
  const todayDiary = diary.filter((x) => x.date === date)

  const toggleTask = async (task: Task) => {
    const next = !task.completed
    setTasks((xs) => xs.map((x) => x.id === task.id && x.date === task.date ? { ...x, completed: next } : x))
    try {
      await api(`/api/tasks/${task.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: next, date: task.date, occurrenceDate: task.occurrenceDate })
      })
    } catch (e) { setError((e as Error).message); await load() }
  }

  const toggleHabit = async (habit: Habit) => {
    try {
      await api(`/api/habits/${habit.id}/toggle`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date })
      })
      setMarks((xs) => marked.has(habit.id) ? xs.filter((x) => x.habitId !== habit.id) : [...xs, { habitId: habit.id, date }])
    } catch (e) { setError((e as Error).message) }
  }

  return <main className="overview-page">
    <header>
      <div><div className="eyebrow">СЕГОДНЯ</div><h1>{new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</h1><p className="muted">Один экран на текущий день: планы, действия и короткий снимок жизни.</p></div>
      <button className="secondary" onClick={load}>Обновить</button>
    </header>
    {error && <div className="message error">{error}</div>}

    <section className="today-grid">
      <article className="card overview-block">
        <div className="overview-block-head"><div><span className="kicker">ПЛАН</span><h2>Задачи</h2></div><button className="link-button" onClick={() => onNavigate('calendar')}>Календарь →</button></div>
        <div className="big-progress"><strong>{completedTasks}/{tasks.length}</strong><span>выполнено</span></div>
        <div className="overview-list">{tasks.length ? tasks.map((task) =>
          <label className={`today-task color-${task.color ?? 'default'} ${task.completed ? 'done' : ''}`} key={task.id + task.date}>
            <input type="checkbox" checked={task.completed} onChange={() => toggleTask(task)} /><span>{task.title}</span>
          </label>
        ) : <p className="muted">На сегодня задач нет.</p>}</div>
      </article>

      <article className="card overview-block">
        <div className="overview-block-head"><div><span className="kicker">ДЕЙСТВИЯ</span><h2>Трекер</h2></div><button className="link-button" onClick={() => onNavigate('habits')}>Весь трекер →</button></div>
        <div className="habit-today-grid">{habits.length ? habits.map((h) => <button key={h.id} className={`habit-today ${marked.has(h.id) ? 'done' : ''}`} onClick={() => toggleHabit(h)}><span className="habit-check">{marked.has(h.id) ? '✓' : ''}</span><span>{h.name}</span></button>) : <p className="muted">Создай действия, которые хочешь отмечать по датам.</p>}</div>
      </article>

      <article className="card quick-card accent-card" onClick={() => onNavigate('flashcards')}>
        <span className="kicker">ПОВТОРЕНИЕ</span><strong>{dueCards}</strong><span>карточек пора повторить</span><small>Открыть карточки →</small>
      </article>

      <article className="card quick-card" onClick={() => onNavigate('operations')}>
        <span className="kicker">ДЕНЬГИ СЕГОДНЯ</span><strong>{spent ? '− ' + money(spent) : money(0)}</strong><span>{earned ? 'доход +' + money(earned) : 'доходов сегодня нет'}</span><small>Операции →</small>
      </article>

      <article className="card quick-card" onClick={() => onNavigate('shifts')}>
        <span className="kicker">РАБОТА</span><strong>{todayShift.length ? todayShift.reduce((s, x) => s + Number(x.hours || 0), 0).toLocaleString('ru-RU') + ' ч' : '—'}</strong><span>{todayShift.length ? todayShift.map((x) => x.name).filter(Boolean).join(', ') : 'смен сегодня нет'}</span><small>Смены →</small>
      </article>

      <article className="card quick-card" onClick={() => onNavigate('workouts')}>
        <span className="kicker">ТРЕНИРОВКА</span><strong>{todayWorkout.length}</strong><span>{todayWorkout.length ? 'упражнений записано' : 'сегодня ничего не записано'}</span><small>Тренировки →</small>
      </article>

      <article className="card quick-card" onClick={() => onNavigate('weights')}>
        <span className="kicker">ВЕС</span><strong>{todayWeight ? Number(todayWeight.weight).toLocaleString('ru-RU') + ' кг' : '—'}</strong><span>{todayWeight ? 'замер за сегодня' : 'сегодня не взвешивался'}</span><small>Вес →</small>
      </article>

      <article className="card quick-card" onClick={() => onNavigate('diary')}>
        <span className="kicker">ДНЕВНИК</span><strong>{todayDiary.length}</strong><span>{todayDiary.length ? 'записей сегодня' : 'сегодня записей нет'}</span><small>Дневник →</small>
      </article>
    </section>
  </main>
}
