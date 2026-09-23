import { useEffect, useMemo, useState } from 'react'
import { api, money } from './api'
import GoalSpotlight from './GoalSpotlight'
import type { PersonalGoal } from './goalTypes'
import './overview.css'

type Task = { id: string; title: string; date: string; completed: boolean; color: string }
type Habit = { id: string; name: string }
type Mark = { habitId: string; date: string }
type Expense = { id: string; amount: number; type: 'expense' | 'income'; date: string }
type Entry = Record<string, any> & { id: string; date?: string }
type Diary = { id: string; date: string }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const parse = (s: string) => new Date(s + 'T12:00:00')
const monday = (d: Date) => { const x = new Date(d); const n = (x.getDay()+6)%7; x.setDate(x.getDate()-n); x.setHours(12,0,0,0); return x }
const add = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate()+n); return x }

export default function WeeklyReview({ onNavigate }: { onNavigate: () => void }) {
  const [anchor, setAnchor] = useState(() => new Date())
  const fromDate = useMemo(() => monday(anchor), [anchor])
  const toDate = useMemo(() => add(fromDate, 6), [fromDate])
  const from = iso(fromDate), to = iso(toDate)
  const [tasks, setTasks] = useState<Task[]>([])
  const [habits, setHabits] = useState<Habit[]>([])
  const [marks, setMarks] = useState<Mark[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [shifts, setShifts] = useState<Entry[]>([])
  const [weights, setWeights] = useState<Entry[]>([])
  const [workouts, setWorkouts] = useState<Entry[]>([])
  const [diary, setDiary] = useState<Diary[]>([])
  const [goals, setGoals] = useState<PersonalGoal[]>([])
  const [goalsLoaded, setGoalsLoaded] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setError('')
    Promise.all([
      api<Task[]>(`/api/tasks?from=${from}&to=${to}`),
      api<Habit[]>('/api/habits'),
      api<Mark[]>(`/api/habit-marks?from=${from}&to=${to}`),
      api<Expense[]>('/api/expenses'),
      api<Entry[]>('/api/journal/shifts'),
      api<Entry[]>('/api/journal/weights'),
      api<Entry[]>('/api/journal/workouts'),
      api<Diary[]>('/api/diary'),
      api<PersonalGoal[]>('/api/personal-goals')
    ]).then(([a,b,c,d,e,f,g,h,i]) => { setTasks(a); setHabits(b); setMarks(c); setExpenses(d); setShifts(e); setWeights(f); setWorkouts(g); setDiary(h); setGoals(i) })
      .catch((e) => setError(e.message))
      .finally(() => setGoalsLoaded(true))
  }, [from, to])

  const week = <T extends { date?: string }>(xs: T[]) => xs.filter((x) => !!x.date && x.date! >= from && x.date! <= to)
  const ops = expenses.filter((x) => x.date >= from && x.date <= to)
  const weekShifts = week(shifts), weekWeights = week(weights), weekWorkouts = week(workouts), weekDiary = diary.filter((x) => x.date >= from && x.date <= to)
  const done = tasks.filter((t) => t.completed).length
  const spent = ops.filter((x) => x.type === 'expense').reduce((s,x)=>s+Number(x.amount),0)
  const earned = ops.filter((x) => x.type === 'income').reduce((s,x)=>s+Number(x.amount),0)
  const shiftPay = weekShifts.reduce((s,x)=>s+Number(x.pay||0),0)
  const shiftHours = weekShifts.reduce((s,x)=>s+Number(x.hours||0),0)
  const workoutDays = new Set(weekWorkouts.map((x)=>x.date)).size
  const sortedWeights = [...weekWeights].sort((a,b)=>String(a.date).localeCompare(String(b.date)))
  const weightStart = sortedWeights[0] ? Number(sortedWeights[0].weight) : null
  const weightEnd = sortedWeights.at(-1) ? Number(sortedWeights.at(-1)!.weight) : null
  const weightDelta = weightStart !== null && weightEnd !== null ? weightEnd-weightStart : null
  const dayDates = Array.from({length:7},(_,i)=>iso(add(fromDate,i)))
  const marksByHabit = new Map(habits.map((h)=>[h.id, new Set(marks.filter((m)=>m.habitId===h.id).map((m)=>m.date))]))

  return <main className="overview-page">
    <header>
      <div><div className="eyebrow">НЕДЕЛЯ В ЦИФРАХ</div><h1>Еженедельный обзор</h1><p className="muted">{fromDate.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})} — {toDate.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})}</p></div>
      <div className="week-nav"><button className="secondary" onClick={()=>setAnchor(add(anchor,-7))}>←</button><button className="secondary" onClick={()=>setAnchor(new Date())}>Текущая неделя</button><button className="secondary" onClick={()=>setAnchor(add(anchor,7))}>→</button></div>
    </header>
    {error && <div className="message error">{error}</div>}
    {goalsLoaded && <GoalSpotlight goals={goals} reference={iso(new Date())} onNavigate={onNavigate} weekly />}

    <section className="review-metrics">
      <article className="card metric"><span>Задачи</span><strong>{tasks.length ? Math.round(done/tasks.length*100) : 0}%</strong><small>{done} из {tasks.length} выполнено</small></article>
      <article className="card metric"><span>Расходы</span><strong>{money(spent)}</strong><small>доходы {money(earned)}</small></article>
      <article className="card metric"><span>Работа</span><strong>{shiftHours.toLocaleString('ru-RU')} ч</strong><small>{weekShifts.length} смен · {money(shiftPay)}</small></article>
      <article className="card metric"><span>Тренировки</span><strong>{workoutDays}</strong><small>дней · {weekWorkouts.length} упражнений</small></article>
      <article className="card metric"><span>Вес</span><strong>{weightEnd !== null ? weightEnd.toLocaleString('ru-RU')+' кг' : '—'}</strong><small>{weightDelta === null ? 'нет пары замеров' : (weightDelta>0?'+':'')+weightDelta.toFixed(1)+' кг за неделю'}</small></article>
      <article className="card metric"><span>Дневник</span><strong>{weekDiary.length}</strong><small>записей за неделю</small></article>
    </section>

    <section className="card weekly-section">
      <div className="section-heading"><div><span className="kicker">РИТМ</span><h2>Действия по дням</h2></div><span className="muted">{marks.length} отметок</span></div>
      {habits.length ? <div className="week-habit-table">
        <div className="week-habit-head"><span></span>{dayDates.map((d)=><span key={d}>{parse(d).toLocaleDateString('ru-RU',{weekday:'short',day:'numeric'})}</span>)}<strong>Итого</strong></div>
        {habits.map((h)=>{ const set=marksByHabit.get(h.id) ?? new Set<string>(); return <div className="week-habit-row" key={h.id}><strong>{h.name}</strong>{dayDates.map((d)=><span className={set.has(d)?'hit':''} key={d}>{set.has(d)?'✓':'·'}</span>)}<b>{set.size}</b></div>})}
      </div> : <p className="muted">Трекеров пока нет.</p>}
    </section>

    <section className="review-columns">
      <article className="card weekly-section">
        <div className="section-heading"><h2>Задачи недели</h2><span className="badge">{done}/{tasks.length}</span></div>
        <div className="overview-list">{tasks.length ? tasks.map((t)=><div className={`review-task color-${t.color ?? 'default'} ${t.completed?'done':''}`} key={t.id+t.date}><span>{t.completed?'✓':'○'}</span><div><strong>{t.title}</strong><small>{parse(t.date).toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'short'})}</small></div></div>) : <p className="muted">Задач не было.</p>}</div>
      </article>
      <article className="card weekly-section">
        <div className="section-heading"><h2>Короткий итог</h2></div>
        <div className="summary-lines">
          <p><span>Чистый денежный поток</span><strong>{money(earned-spent)}</strong></p>
          <p><span>Рабочих дней</span><strong>{new Set(weekShifts.map((x)=>x.date)).size}</strong></p>
          <p><span>Дней с тренировкой</span><strong>{workoutDays}</strong></p>
          <p><span>Дней с записью в дневнике</span><strong>{new Set(weekDiary.map((x)=>x.date)).size}</strong></p>
          <p><span>Отметок действий</span><strong>{marks.length}</strong></p>
        </div>
      </article>
    </section>
  </main>
}
