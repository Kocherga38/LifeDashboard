import type { PersonalGoal } from './goalTypes'
import { goalDeadline, visibleGoals } from './goalTypes'

export default function GoalSpotlight({ goals, reference, onNavigate, weekly = false }: {
  goals: PersonalGoal[]
  reference: string
  onNavigate: () => void
  weekly?: boolean
}) {
  const shown = visibleGoals(goals)
  return <section className="goal-spotlight" aria-labelledby={weekly ? 'weekly-goals-title' : 'today-goals-title'}>
    <div className="goal-spotlight-heading">
      <div><span className="eyebrow">{weekly ? 'ДЕРЖАТЬ КУРС' : 'ПЕРЕД ГЛАЗАМИ'}</span><h2 id={weekly ? 'weekly-goals-title' : 'today-goals-title'}>Мои цели</h2></div>
      <button className="link-button" onClick={onNavigate}>{shown.length ? 'Все цели' : 'Создать цель'} →</button>
    </div>
    {shown.length ? <>
      <div className="goal-spotlight-grid">
        {shown.slice(0, 3).map((goal, index) => <article className="goal-preview" key={goal.id}>
          <span className="goal-preview-index">0{index + 1} / ЦЕЛЬ</span>
          <h3>{goal.title}</h3>
          <span className={`goal-preview-deadline ${goal.dueDate && goal.dueDate < reference ? 'overdue' : ''}`}>{goalDeadline(goal.dueDate, reference)}</span>
          {goal.nextStep && <p><span>СЛЕДУЮЩИЙ ШАГ</span>{goal.nextStep}</p>}
        </article>)}
      </div>
      {shown.length > 3 && <button className="goal-more link-button" onClick={onNavigate}>Ещё {shown.length - 3} в разделе «Цели» →</button>}
    </> : <div className="goal-spotlight-empty">
      <span aria-hidden="true">✳</span>
      <p>{goals.some((goal) => goal.status === 'active') ? 'Закрепи цель в разделе «Цели», и она появится здесь.' : 'Добавь цель, которую хочешь держать перед глазами.'}</p>
      <button className="secondary" onClick={onNavigate}>Открыть цели →</button>
    </div>}
  </section>
}
