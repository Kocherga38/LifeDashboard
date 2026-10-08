export type PersonalGoal = {
  id: string
  title: string
  description: string
  nextStep: string
  dueDate: string | null
  status: 'active' | 'paused' | 'completed'
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export type MonthlyGoal = {
  id: string
  parentId: string
  parentSubgoalId: string | null
  month: string
  title: string
  description: string
  nextStep: string
  completed: boolean
  createdAt: string
  updatedAt: string
}

export function monthlyGoalRows(goals: MonthlyGoal[]) {
  const ids = new Set(goals.map((goal) => goal.id))
  const children = new Map<string | null, MonthlyGoal[]>()
  for (const goal of goals) {
    const parent = goal.parentSubgoalId && ids.has(goal.parentSubgoalId) ? goal.parentSubgoalId : null
    children.set(parent, [...(children.get(parent) ?? []), goal])
  }
  const rows: { goal: MonthlyGoal; depth: number }[] = []
  const visited = new Set<string>()
  const visit = (goal: MonthlyGoal, depth: number) => {
    if (visited.has(goal.id)) return
    visited.add(goal.id)
    rows.push({ goal, depth })
    for (const child of children.get(goal.id) ?? []) visit(child, depth + 1)
  }
  for (const goal of children.get(null) ?? []) visit(goal, 0)
  return rows
}

export function monthlyGoalDescendants(goals: MonthlyGoal[], id: string) {
  const found = new Set<string>([id])
  const pending = [id]
  while (pending.length) {
    const parent = pending.pop()
    for (const goal of goals) {
      if (goal.parentSubgoalId === parent && !found.has(goal.id)) {
        found.add(goal.id)
        pending.push(goal.id)
      }
    }
  }
  found.delete(id)
  return found
}

export const monthLabel = (month: string) =>
  new Date(`${month}-01T12:00:00`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })

export function shiftMonth(month: string, offset: number) {
  const [year, number] = month.split('-').map(Number)
  const date = new Date(year, number - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export const visibleGoals = (goals: PersonalGoal[]) =>
  goals.filter((goal) => goal.status === 'active' && goal.pinned)

export function goalDeadline(date: string | null, reference: string) {
  if (!date) return 'Без срока'
  const label = new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric'
  })
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${reference}T00:00:00Z`)) / 86400000)
  if (days < 0) return `Срок прошёл · ${label}`
  if (days === 0) return 'Срок сегодня'
  if (days <= 7) return `${days} дн. осталось · ${label}`
  return `До ${label}`
}
