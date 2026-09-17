import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

type Operation = {
  id: string
  title: string
  amount: number
  category: string
  type: 'expense' | 'income'
  date: string
}

type Budget = {
  id: string
  category: string
  amount: number
  month: string
}

const colors = [
  '#b6f36b',
  '#a78bfa',
  '#67d8ef',
  '#ffbb70',
  '#f48fb1',
  '#759cff',
  '#e5d477',
  '#68d6b2'
]

const defaultCategories = [
  'Продукты',
  'Транспорт',
  'Жильё',
  'Развлечения',
  'Здоровье',
  'Одежда',
  'Другое'
]

function currentMonth() {
  const date = new Date()

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function money(amount: number) {
  return amount.toLocaleString('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 2
  })
}

function total(items: Operation[]) {
  return items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100
}

function monthTitle(month: string) {
  const [year, number] = month.split('-').map(Number)

  return new Date(year, number - 1, 1).toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric'
  })
}

function shortNumber(value: number) {
  return Intl.NumberFormat('ru-RU', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(value)
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? `Ошибка сервера: ${response.status}`)
  }

  if (response.status === 204) return undefined as T

  return response.json() as Promise<T>
}

const tooltipStyle = {
  backgroundColor: '#202632',
  border: '1px solid #414b5d',
  borderRadius: 12,
  color: '#eff2f8'
}

export default function Analytics() {
  const [month, setMonth] = useState(currentMonth)
  const [operations, setOperations] = useState<Operation[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [loading, setLoading] = useState(true)
  const [loadedMonth, setLoadedMonth] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)

  const [category, setCategory] = useState('Продукты')
  const [limit, setLimit] = useState('')
  const inProgress = useRef(false)
  const limitInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const controller = new AbortController()

    setLoading(true)
    setLoadedMonth('')
    setError('')
    setNotice('')

    async function load() {
      try {
        const [operationData, budgetData] = await Promise.all([
          api<Operation[]>('/api/expenses', {
            signal: controller.signal
          }),
          api<Budget[]>(`/api/budgets?month=${month}`, {
            signal: controller.signal
          })
        ])

        if (!controller.signal.aborted) {
          setOperations(operationData)
          setBudgets(budgetData)
          setLoadedMonth(month)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : 'Ошибка загрузки.')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()

    return () => controller.abort()
  }, [month, reload])

  const ready = loadedMonth === month && !loading

  const selected = operations.filter((item) => item.date.startsWith(month))
  const expenses = selected.filter((item) => item.type === 'expense')
  const incomes = selected.filter((item) => item.type === 'income')

  const expenseTotal = total(expenses)
  const incomeTotal = total(incomes)
  const balance = (Math.round(incomeTotal * 100) - Math.round(expenseTotal * 100)) / 100

  const categoryData = Array.from(new Set(expenses.map((item) => item.category)))
    .map((name) => ({
      name,
      amount: total(expenses.filter((item) => item.category === name))
    }))
    .sort((a, b) => b.amount - a.amount)
    .map((item, index) => ({
      ...item,
      fill: colors[index % colors.length]
    }))

  const [year, monthNumber] = month.split('-').map(Number)
  const daysInMonth = new Date(year, monthNumber, 0).getDate()

  const dailyData = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1
    const date = `${month}-${String(day).padStart(2, '0')}`

    return {
      day,
      date,
      amount: total(expenses.filter((item) => item.date === date))
    }
  })

  // Двенадцать месяцев, заканчивающихся выбранным месяцем.
  const monthlyData = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(year, monthNumber - 12 + index, 1)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const items = operations.filter((item) => item.date.startsWith(key))

    return {
      month: key,
      label: date.toLocaleDateString('ru-RU', {
        month: 'short',
        year: '2-digit'
      }),
      income: total(items.filter((item) => item.type === 'income')),
      expense: total(items.filter((item) => item.type === 'expense'))
    }
  })

  const categories = Array.from(
    new Set([
      ...defaultCategories,
      ...operations.filter((item) => item.type === 'expense').map((item) => item.category),
      ...budgets.map((item) => item.category)
    ])
  ).sort((a, b) => a.localeCompare(b, 'ru'))

  const budgetRows = budgets.map((budget) => {
    const spent = total(expenses.filter((item) => item.category === budget.category))

    return {
      ...budget,
      spent,
      remaining: (Math.round(budget.amount * 100) - Math.round(spent * 100)) / 100,
      percent: (spent / budget.amount) * 100
    }
  })

  const budgetTotal = budgets.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100

  const unbudgeted = categoryData.filter(
    (item) => !budgets.some((budget) => budget.category === item.name)
  )

  async function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!ready || inProgress.current) return

    const amount = Number(limit.replace(',', '.'))

    if (!category.trim() || !Number.isFinite(amount) || amount < 0.01 || amount > 999999999.99) {
      setError('Укажи категорию и положительный лимит до 999 999 999,99 ₽.')
      return
    }

    inProgress.current = true
    setBusy(true)
    setError('')
    setNotice('')

    try {
      const saved = await api<Budget>('/api/budgets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: category.trim(),
          amount,
          month
        })
      })

      setBudgets((current) =>
        [...current.filter((item) => item.id !== saved.id), saved].sort((a, b) =>
          a.category.localeCompare(b.category, 'ru')
        )
      )

      setLimit('')
      setNotice(`Лимит для «${saved.category}» сохранён.`)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Ошибка сохранения.')
    } finally {
      inProgress.current = false
      setBusy(false)
    }
  }

  async function deleteBudget(budget: Budget) {
    if (!ready || inProgress.current) return
    if (!window.confirm(`Удалить лимит для «${budget.category}»?`)) return

    inProgress.current = true
    setBusy(true)
    setError('')
    setNotice('')

    try {
      await api<void>(`/api/budgets/${budget.id}`, { method: 'DELETE' })
      setBudgets((current) => current.filter((item) => item.id !== budget.id))
      setNotice('Лимит удалён. Расходы сохранены.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Ошибка удаления.')
    } finally {
      inProgress.current = false
      setBusy(false)
    }
  }

  return (
    <main className="analytics">
      <header>
        <div>
          <p className="eyebrow">LIFE / АНАЛИТИКА</p>
          <h1>Деньги в деталях</h1>
          <p className="muted">{monthTitle(month)} · по записанным операциям</p>
        </div>

        <div className="period">
          <label>
            Месяц
            <input
              type="month"
              min="1900-01"
              max="2100-12"
              value={month}
              disabled={busy}
              onChange={(event) => {
                if (event.target.value) {
                  setMonth(event.target.value)
                  setLimit('')
                }
              }}
            />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={busy || loading}
            onClick={() => setReload((value) => value + 1)}
          >
            Обновить
          </button>
        </div>
      </header>

      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="message success" role="status">
          {notice}
        </p>
      )}
      {!ready && (
        <p className="muted">{loading ? 'Загружаем аналитику…' : 'Данные не загружены.'}</p>
      )}

      {ready && (
        <>
          <section className="summary">
            <article className="card">
              <p className="muted">Доходы за месяц</p>
              <div className="big-number positive">{money(incomeTotal)}</div>
            </article>
            <article className="card">
              <p className="muted">Расходы за месяц</p>
              <div className="big-number">{money(expenseTotal)}</div>
            </article>
            <article className="card">
              <p className="muted">Разница за месяц</p>
              <div className={`big-number ${balance < 0 ? 'negative' : 'positive'}`}>
                {money(balance)}
              </div>
            </article>
          </section>

          <section className="card analytics-wide">
            <div className="section-heading">
              <h2>Расходы по дням</h2>
              <span className="badge">{monthTitle(month)}</span>
            </div>

            {expenses.length === 0 ? (
              <div className="chart-empty">В этом месяце пока нет записанных расходов.</div>
            ) : (
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyData} margin={{ top: 12, right: 12, bottom: 0, left: 8 }}>
                    <CartesianGrid stroke="#303846" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" stroke="#969eaf" tickLine={false} />
                    <YAxis
                      stroke="#969eaf"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={shortNumber}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      itemStyle={{ color: '#eff2f8' }}
                      cursor={{ fill: '#ffffff08' }}
                      formatter={(value) => money(Number(value))}
                      labelFormatter={(value) =>
                        `${String(value).padStart(2, '0')}.${String(monthNumber).padStart(2, '0')}.${year}`
                      }
                    />
                    <Bar
                      animationDuration={300}
                      dataKey="amount"
                      name="Расходы"
                      fill="#b6f36b"
                      radius={[5, 5, 0, 0]}
                      maxBarSize={32}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <div className="analytics-grid">
            <section className="card">
              <h2>Доходы и расходы · 12 месяцев</h2>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData} margin={{ top: 12, right: 8, bottom: 8, left: 8 }}>
                    <CartesianGrid stroke="#303846" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      stroke="#969eaf"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="#969eaf"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={shortNumber}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      itemStyle={{ color: '#eff2f8' }}
                      cursor={{ fill: '#ffffff08' }}
                      formatter={(value) => money(Number(value))}
                    />
                    <Legend />
                    <Bar
                      animationDuration={300}
                      dataKey="income"
                      name="Доходы"
                      fill="#b6f36b"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      animationDuration={300}
                      dataKey="expense"
                      name="Расходы"
                      fill="#a78bfa"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="card">
              <h2>На что уходят деньги</h2>

              {categoryData.length === 0 ? (
                <div className="chart-empty">Добавь расходы, чтобы увидеть распределение.</div>
              ) : (
                <>
                  <div className="chart-box donut-box">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          animationBegin={0}
                          animationDuration={300}
                          data={categoryData}
                          dataKey="amount"
                          nameKey="name"
                          innerRadius={68}
                          outerRadius={105}
                          paddingAngle={2}
                          stroke="none"
                        />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          itemStyle={{ color: '#eff2f8' }}
                          formatter={(value) => money(Number(value))}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="category-legend">
                    {categoryData.map((item) => (
                      <div className="category-item" key={item.name}>
                        <span className="color-dot" style={{ background: item.fill }} />
                        <span>{item.name}</span>
                        <strong>{money(item.amount)}</strong>
                        <span className="muted">
                          {((item.amount / expenseTotal) * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>

          <section className="card analytics-wide">
            <div className="section-heading">
              <div>
                <h2>Бюджет на месяц</h2>
                <p className="muted budget-description">
                  {monthTitle(month)} · сумма заданных лимитов: {money(budgetTotal)}
                </p>
              </div>
            </div>

            <form className="budget-form" onSubmit={saveBudget}>
              <label>
                Категория расходов
                <input
                  list="budget-categories"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  required
                  maxLength={100}
                  disabled={busy}
                />
                <datalist id="budget-categories">
                  {categories.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>

              <label>
                Лимит, ₽
                <input
                  ref={limitInput}
                  type="number"
                  min="0.01"
                  max="999999999.99"
                  step="0.01"
                  placeholder="Например, 10000"
                  value={limit}
                  onChange={(event) => setLimit(event.target.value)}
                  required
                  disabled={busy}
                />
              </label>

              <button type="submit" disabled={busy}>
                {busy ? 'Сохраняем…' : 'Сохранить лимит'}
              </button>
            </form>

            <p className="muted budget-hint">
              Повторное сохранение той же категории обновит её лимит. Лимиты других месяцев не
              изменятся.
            </p>

            {budgetRows.length === 0 && (
              <p className="muted">На этот месяц лимиты пока не заданы.</p>
            )}

            <div className="budget-list">
              {budgetRows.map((item) => (
                <div className="budget-item" key={item.id}>
                  <div className="budget-heading">
                    <strong>{item.category}</strong>
                    <span>
                      {money(item.spent)} / {money(item.amount)}
                    </span>

                    <button
                      type="button"
                      className="icon-button"
                      title="Изменить лимит"
                      aria-label={`Изменить лимит: ${item.category}`}
                      disabled={busy}
                      onClick={() => {
                        setCategory(item.category)
                        setLimit(String(item.amount))
                        limitInput.current?.focus()
                      }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="icon-button delete"
                      title="Удалить лимит"
                      aria-label={`Удалить лимит: ${item.category}`}
                      disabled={busy}
                      onClick={() => void deleteBudget(item)}
                    >
                      ×
                    </button>
                  </div>

                  <div className="track">
                    <div
                      className="bar"
                      style={{
                        width: `${Math.min(item.percent, 100)}%`,
                        background: item.remaining < 0 ? '#ff9292' : '#b6f36b'
                      }}
                    />
                  </div>

                  <div className="budget-footer">
                    <span className={item.remaining < 0 ? 'negative' : 'muted'}>
                      {item.remaining < 0
                        ? `Превышение: ${money(-item.remaining)}`
                        : `Осталось: ${money(item.remaining)}`}
                    </span>
                    <span className="muted">{item.percent.toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>

            {unbudgeted.length > 0 && (
              <p className="muted budget-hint">
                Расходы без заданного лимита: {unbudgeted.map((item) => item.name).join(', ')}.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  )
}
