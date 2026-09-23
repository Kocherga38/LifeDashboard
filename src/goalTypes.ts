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
  month: string
  title: string
  description: string
  nextStep: string
  completed: boolean
  createdAt: string
  updatedAt: string
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
