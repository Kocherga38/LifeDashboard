import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { buildFinancialForecast } from './financeForecast'

type OperationType = 'expense' | 'income'

type Operation = {
  id: string
  title: string
  amount: number
  category: string
  type: OperationType
  date: string
  subcategory?: string
  counterparty?: string
  note?: string
}

type TemplateKind = 'quick' | 'recurring'
type Recurrence = 'weekly' | 'monthly' | 'yearly'
type OperationTemplate = Omit<Operation, 'date'> & {
  templateKind: TemplateKind
  recurrence: Recurrence | null
  nextDate: string | null
}

const defaultCategories = {
  expense: ['Продукты', 'Транспорт', 'Жильё', 'Развлечения', 'Здоровье', 'Одежда', 'Другое'],
  income: ['Подработки', 'Зарплата', 'Подарки', 'Другое']
}

function today() {
  const now = new Date()

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-')
}

function money(value: number) {
  return value.toLocaleString('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 2
  })
}

function total(items: Operation[]) {
  return items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100
}

function addDays(date: string, amount: number) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10)
}

function endOfMonth(month: string) {
  const [year, value] = month.split('-').map(Number)
  return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10)
}

function dateLabel(date: string) {
  return date.split('-').reverse().join('.')
}

function daysBetween(from: string, to: string) {
  const parts = (value: string) => value.split('-').map(Number)
  const [fromYear, fromMonth, fromDay] = parts(from)
  const [toYear, toMonth, toDay] = parts(to)
  return Math.round(
    (Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) /
      86400000
  )
}

function daysLabel(date: string, currentDate: string) {
  const days = daysBetween(currentDate, date)
  if (days === 0) return 'сегодня'
  if (days === 1) return 'завтра'
  const absolute = Math.abs(days)
  const mod10 = absolute % 10
  const mod100 = absolute % 100
  const word = mod10 === 1 && mod100 !== 11 ? 'день' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'дня' : 'дней'
  if (days < 0) return `просрочен на ${absolute} ${word}`
  return `через ${days} ${word}`
}

function paymentsLabel(value: number) {
  const mod10 = value % 10
  const mod100 = value % 100
  const word = mod10 === 1 && mod100 !== 11 ? 'платёж' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'платежа' : 'платежей'
  return `${value} ${word}`
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? `Ошибка сервера: ${response.status}`)
  }

  if (response.status === 204) return undefined as T

  return response.json() as Promise<T>
}

export default function Operations() {
  const [operations, setOperations] = useState<Operation[]>([])
  const [templates, setTemplates] = useState<OperationTemplate[]>([])
  const [month, setMonth] = useState(today().slice(0, 7))
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [counterparty, setCounterparty] = useState('')
  const [note, setNote] = useState('')
  const [search, setSearch] = useState('')
  const [type, setType] = useState<OperationType>('expense')
  const [category, setCategory] = useState('Продукты')
  const [date, setDate] = useState(today)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastAdded, setLastAdded] = useState<Operation | null>(null)
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false)
  const [templateEditingId, setTemplateEditingId] = useState<string | null>(null)
  const [templateTitle, setTemplateTitle] = useState('')
  const [templateAmount, setTemplateAmount] = useState('')
  const [templateType, setTemplateType] = useState<OperationType>('expense')
  const [templateCategory, setTemplateCategory] = useState('Продукты')
  const [templateKind, setTemplateKind] = useState<TemplateKind>('quick')
  const [templateRecurrence, setTemplateRecurrence] = useState<Recurrence>('monthly')
  const [templateNextDate, setTemplateNextDate] = useState(today)

  const inProgress = useRef(false)
  const titleInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const [data, savedTemplates] = await Promise.all([
          request<Operation[]>('/api/expenses', { signal: controller.signal }),
          request<OperationTemplate[]>('/api/templates', { signal: controller.signal })
        ])

        if (!controller.signal.aborted) {
          setOperations(data)
          setTemplates(savedTemplates)
          setLoaded(true)
        }
      } catch {
        if (!controller.signal.aborted) {
          setError('Не удалось загрузить операции. Проверь сервер и обнови страницу.')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [])

  const disabled = loading || busy || !loaded

  const categories = Array.from(
    new Set([
      ...defaultCategories[type],
      ...operations.filter((item) => item.type === type).map((item) => item.category),
      ...templates.filter((item) => item.type === type).map((item) => item.category),
      category
    ])
  )

  const visible = operations
    .filter((item) => !month || item.date.startsWith(month))
    .filter((item) =>
      [item.title, item.category, item.subcategory, item.counterparty, item.note]
        .join(' ')
        .toLocaleLowerCase('ru')
        .includes(search.toLocaleLowerCase('ru'))
    )
    .sort((a, b) => b.date.localeCompare(a.date))

  const expenses = visible.filter((item) => item.type === 'expense')
  const incomeTotal = total(visible.filter((item) => item.type === 'income'))
  const expenseTotal = total(expenses)
  const balance = (Math.round(incomeTotal * 100) - Math.round(expenseTotal * 100)) / 100

  const currentDate = today()
  const periodOperations = operations.filter((item) => !month || item.date.startsWith(month))
  const periodIncome = total(periodOperations.filter((item) => item.type === 'income'))
  const periodExpenses = total(periodOperations.filter((item) => item.type === 'expense'))
  const periodBalance =
    (Math.round(periodIncome * 100) - Math.round(periodExpenses * 100)) / 100
  const forecastStart = month && `${month}-01` > currentDate ? `${month}-01` : currentDate
  const forecastEnd = month ? endOfMonth(month) : addDays(currentDate, 30)
  const forecast = buildFinancialForecast(templates, periodBalance, forecastStart, forecastEnd)
  const forecastWindow =
    forecastStart > forecastEnd
      ? 'Период завершён'
      : month
        ? `До ${dateLabel(forecastEnd)}`
        : 'Следующие 30 дней'

  const breakdown = Array.from(new Set(expenses.map((item) => item.category)))
    .map((name) => ({
      name,
      amount: total(expenses.filter((item) => item.category === name))
    }))
    .sort((a, b) => b.amount - a.amount)

  const maximum = Math.max(...breakdown.map((item) => item.amount), 1)

  function resetForm() {
    setEditingId(null)
    setTitle('')
    setAmount('')
    setSubcategory('')
    setCounterparty('')
    setNote('')
    setType('expense')
    setCategory('Продукты')
    setDate(today())
  }

  function resetTemplateForm() {
    setTemplateEditingId(null)
    setTemplateTitle('')
    setTemplateAmount('')
    setTemplateType('expense')
    setTemplateCategory('Продукты')
    setTemplateKind('quick')
    setTemplateRecurrence('monthly')
    setTemplateNextDate(today())
  }

  function editTemplate(item: OperationTemplate) {
    setTemplateEditingId(item.id)
    setTemplateTitle(item.title)
    setTemplateAmount(String(item.amount))
    setTemplateType(item.type)
    setTemplateCategory(item.category)
    setTemplateKind(item.templateKind)
    setTemplateRecurrence(item.recurrence || 'monthly')
    setTemplateNextDate(item.nextDate || today())
    setTemplateEditorOpen(true)
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled || inProgress.current) return
    const value = Number(templateAmount.replace(',', '.'))
    if (
      !templateTitle.trim() ||
      !templateCategory.trim() ||
      !Number.isFinite(value) ||
      value < 0.01
    ) {
      setError('Проверь название, сумму и категорию шаблона.')
      return
    }
    inProgress.current = true
    setBusy(true)
    setError('')
    setNotice('')
    setLastAdded(null)
    try {
      const id = templateEditingId
      const saved = await request<OperationTemplate>(
        id ? `/api/templates/${id}` : '/api/templates',
        {
          method: id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: templateTitle.trim(),
            amount: value,
            type: templateType,
            category: templateCategory.trim(),
            templateKind,
            recurrence: templateKind === 'recurring' ? templateRecurrence : null,
            nextDate: templateKind === 'recurring' ? templateNextDate : null
          })
        }
      )
      setTemplates((current) =>
        id ? current.map((item) => (item.id === id ? saved : item)) : [...current, saved]
      )
      resetTemplateForm()
      setTemplateEditorOpen(false)
      setNotice(id ? 'Шаблон обновлён.' : 'Шаблон создан.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Ошибка сохранения шаблона.')
    } finally {
      inProgress.current = false
      setBusy(false)
    }
  }

  async function useTemplate(item: OperationTemplate) {
    if (disabled || inProgress.current) return
    inProgress.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{
        operation: Operation
        template: OperationTemplate
      }>(`/api/templates/${item.id}/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today() })
      })
      setOperations((current) => [result.operation, ...current])
      setTemplates((current) =>
        current.map((template) => (template.id === item.id ? result.template : template))
      )
      if (month && !result.operation.date.startsWith(month)) {
        setMonth(result.operation.date.slice(0, 7))
      }
      setLastAdded(result.operation)
      setNotice(`«${result.operation.title}» добавлено.`)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Ошибка добавления по шаблону.')
    } finally {
      inProgress.current = false
      setBusy(false)
    }
  }

  async function removeTemplate(item: OperationTemplate) {
    if (disabled || inProgress.current || !window.confirm(`Удалить шаблон «${item.title}»?`)) {
      return
    }
    inProgress.current = true
    setBusy(true)
    setError('')
    setNotice('')
    setLastAdded(null)
    try {
      await request<void>(`/api/templates/${item.id}`, { method: 'DELETE' })
      setTemplates((current) => current.filter((template) => template.id !== item.id))
      if (templateEditingId === item.id) resetTemplateForm()
      setNotice('Шаблон удалён.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Ошибка удаления шаблона.')
    } finally {
      inProgress.current = false
      setBusy(false)
    }
  }

  function changeType(value: OperationType) {
    setType(value)
    setCategory(defaultCategories[value][0])
  }

  function edit(item: Operation) {
    if (disabled) return

    setEditingId(item.id)
    setTitle(item.title)
    setAmount(String(item.amount))
    setType(item.type)
    setCategory(item.category)
    setDate(item.date)
    setSubcategory(item.subcategory || '')
    setCounterparty(item.counterparty || '')
    setNote(item.note || '')
    setError('')
    setNotice('')
    setLastAdded(null)
    titleInput.current?.focus()
    titleInput.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled || inProgress.current) return

    const value = Number(amount.replace(',', '.'))

    if (
      !title.trim() ||
      !category.trim() ||
      !Number.isFinite(value) ||
      value < 0.01 ||
      value > 999999999.99 ||
      !date
    ) {
      setError('Проверь название, сумму, категорию и дату.')
      return
    }

    inProgress.current = true
    setBusy(true)
    setError('')
    setNotice('')
    setLastAdded(null)

    const id = editingId

    try {
      const saved = await request<Operation>(id ? `/api/expenses/${id}` : '/api/expenses', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          amount: value,
          type,
          category,
          date,
          subcategory,
          counterparty,
          note
        })
      })

      setOperations((current) =>
        id ? current.map((item) => (item.id === id ? saved : item)) : [saved, ...current]
      )

      if (month && !saved.date.startsWith(month)) {
        setMonth(saved.date.slice(0, 7))
      }

      resetForm()
      setNotice(id ? 'Изменения сохранены.' : 'Операция добавлена.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Ошибка сохранения.')
    } finally {
      inProgress.current = false
      setBusy(false)
    }
  }

  async function remove(item: Operation) {
    if (disabled || inProgress.current) return
    if (!window.confirm(`Удалить «${item.title}»?`)) return

    inProgress.current = true
    setBusy(true)
    setError('')
    setNotice('')
    setLastAdded(null)

    try {
      await request<void>(`/api/expenses/${item.id}`, { method: 'DELETE' })

      setOperations((current) => current.filter((operation) => operation.id !== item.id))

      if (editingId === item.id) resetForm()
      setNotice('Операция удалена.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Ошибка удаления.')
    } finally {
      inProgress.current = false
      setBusy(false)
    }
  }

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">LIFE / ЛИЧНАЯ СТАТИСТИКА</p>
          <h1>Мои деньги</h1>
          <p className="muted">Доходы, расходы и картина за месяц.</p>
        </div>

        <div className="period">
          <label>
            Период
            <input
              type="month"
              min="1900-01"
              max="2100-12"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
          <button type="button" className="secondary" onClick={() => setMonth('')}>
            Всё время
          </button>
        </div>
      </header>

      {loading && <p className="muted">Загружаем операции…</p>}
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="message success" role="status">
          {notice}{' '}
          {lastAdded && (
            <button
              type="button"
              className="inline-action"
              onClick={() => {
                edit(lastAdded)
                setLastAdded(null)
              }}
            >
              Изменить
            </button>
          )}
        </p>
      )}

      <section className="summary">
        <article className="card">
          <p className="muted">Доходы</p>
          <div className="big-number positive">{loaded ? money(incomeTotal) : '—'}</div>
        </article>
        <article className="card">
          <p className="muted">Расходы</p>
          <div className="big-number">{loaded ? money(expenseTotal) : '—'}</div>
        </article>
        <article className="card">
          <p className="muted">Разница за период</p>
          <div className={`big-number ${balance < 0 ? 'negative' : 'positive'}`}>
            {loaded ? money(balance) : '—'}
          </div>
        </article>
      </section>

      <section className="forecast-section" aria-labelledby="forecast-title">
        <div className="forecast-heading">
          <h2 id="forecast-title">Обязательства и прогноз</h2>
          <span className="badge">{forecastWindow}</span>
        </div>
        <div className="summary forecast-summary">
          <article className="card forecast-card">
            <p className="muted">Предстоящие обязательства</p>
            <div className="big-number forecast-obligation">
              {loaded
                ? forecast.expenseTotal > 0
                  ? `−${money(forecast.expenseTotal)}`
                  : money(0)
                : '—'}
            </div>
            {loaded && (
              <small>
                {paymentsLabel(forecast.paymentCount)}
                {forecast.overdueCount > 0 ? ` · просрочено ${forecast.overdueCount}` : ''}
                {forecast.incomeTotal > 0
                  ? ` · ожидаемые доходы +${money(forecast.incomeTotal)}`
                  : ''}
              </small>
            )}
          </article>
          <article className="card forecast-card">
            <p className="muted">Прогноз после обязательств</p>
            <div
              className={`big-number ${forecast.forecastBalance < 0 ? 'negative' : 'positive'}`}
            >
              {loaded ? money(forecast.forecastBalance) : '—'}
            </div>
            {loaded && forecast.firstShortfall && (
              <small className="forecast-warning">
                К {dateLabel(forecast.firstShortfall.date)} по потоку не хватает{' '}
                {money(forecast.firstShortfall.amount)}
              </small>
            )}
            {loaded && !forecast.firstShortfall && forecast.paymentCount > 0 && (
              <small>Все ближайшие обязательства покрыты.</small>
            )}
            {loaded && forecast.paymentCount === 0 && (
              <small>Регулярных расходов в этом окне нет.</small>
            )}
          </article>
          <article className="card forecast-card">
            <p className="muted">Ближайший платёж</p>
            <div className="big-number">
              {loaded && forecast.nearestExpense ? money(forecast.nearestExpense.amount) : '—'}
            </div>
            {loaded && forecast.nearestExpense ? (
              <small>
                {forecast.nearestExpense.title} · {dateLabel(forecast.nearestExpense.date)} ·{' '}
                {daysLabel(forecast.nearestExpense.date, currentDate)}
              </small>
            ) : (
              loaded && <small>В выбранном окне платежей нет.</small>
            )}
          </article>
        </div>
        <p className="forecast-note">
          Прогноз считает денежный поток периода, а не фактический остаток на карте
          {search ? '; поиск на него не влияет' : ''}.
        </p>
      </section>

      <section className={`card form-card ${editingId ? 'editing' : ''}`}>
        <div className="section-heading">
          <h2>{editingId ? 'Редактирование операции' : 'Новая операция'}</h2>
          <div className="type-switch">
            <button
              type="button"
              className={type === 'expense' ? 'active' : ''}
              disabled={disabled}
              onClick={() => changeType('expense')}
            >
              Расход
            </button>
            <button
              type="button"
              className={type === 'income' ? 'active' : ''}
              disabled={disabled}
              onClick={() => changeType('income')}
            >
              Доход
            </button>
          </div>
        </div>

        <form onSubmit={save}>
          <div className="form-grid">
            <label>
              Название
              <input
                ref={titleInput}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={type === 'expense' ? 'Продукты на ужин' : 'Оплата смены'}
                required
                maxLength={100}
                disabled={disabled}
              />
            </label>

            <label>
              Сумма, ₽
              <input
                type="number"
                min="0.01"
                max="999999999.99"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
                disabled={disabled}
              />
            </label>

            <label>
              Категория
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                disabled={disabled}
              >
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Дата
              <input
                type="date"
                min="1900-01-01"
                max="2100-12-31"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
                disabled={disabled}
              />
            </label>
          </div>

          <details style={{ marginTop: 18 }}>
            <summary>Подкатегория, место и комментарий</summary>
            <div className="journal-form" style={{ marginTop: 14 }}>
              <label>
                Подкатегория
                <input
                  value={subcategory}
                  disabled={disabled}
                  maxLength={200}
                  onChange={(e) => setSubcategory(e.target.value)}
                />
              </label>
              <label>
                Где / кому
                <input
                  value={counterparty}
                  disabled={disabled}
                  maxLength={200}
                  onChange={(e) => setCounterparty(e.target.value)}
                />
              </label>
              <label>
                Комментарий
                <input
                  value={note}
                  disabled={disabled}
                  maxLength={5000}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </div>
          </details>
          <div className="form-actions">
            <button type="submit" disabled={disabled}>
              {busy ? 'Сохраняем…' : editingId ? 'Сохранить изменения' : 'Добавить'}
            </button>
            {editingId && (
              <button type="button" className="secondary" disabled={busy} onClick={resetForm}>
                Отмена
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="card templates-card">
        <div className="section-heading">
          <div>
            <h2>Шаблоны</h2>
            <p className="muted template-hint">Один тап — и полноценная операция уже в Life.</p>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            onClick={() => {
              resetTemplateForm()
              setTemplateEditorOpen((open) => !open)
            }}
          >
            {templateEditorOpen ? 'Закрыть' : '+ Новый шаблон'}
          </button>
        </div>

        {templateEditorOpen && (
          <form className="template-editor" onSubmit={saveTemplate}>
            <div className="form-grid template-form-grid">
              <label>
                Название
                <input
                  value={templateTitle}
                  onChange={(event) => setTemplateTitle(event.target.value)}
                  placeholder="Вода"
                  maxLength={100}
                  required
                  disabled={disabled}
                />
              </label>
              <label>
                Сумма, ₽
                <input
                  type="number"
                  min="0.01"
                  max="999999999.99"
                  step="0.01"
                  value={templateAmount}
                  onChange={(event) => setTemplateAmount(event.target.value)}
                  required
                  disabled={disabled}
                />
              </label>
              <label>
                Категория
                <input
                  value={templateCategory}
                  onChange={(event) => setTemplateCategory(event.target.value)}
                  maxLength={100}
                  required
                  disabled={disabled}
                />
              </label>
              <label>
                Тип
                <select
                  value={templateType}
                  disabled={disabled}
                  onChange={(event) => {
                    const value = event.target.value as OperationType
                    setTemplateType(value)
                    setTemplateCategory(defaultCategories[value][0])
                  }}
                >
                  <option value="expense">Расход</option>
                  <option value="income">Доход</option>
                </select>
              </label>
              <label>
                Режим
                <select
                  value={templateKind}
                  disabled={disabled}
                  onChange={(event) => setTemplateKind(event.target.value as TemplateKind)}
                >
                  <option value="quick">Быстрый</option>
                  <option value="recurring">Регулярный</option>
                </select>
              </label>
              {templateKind === 'recurring' && (
                <>
                  <label>
                    Повтор
                    <select
                      value={templateRecurrence}
                      disabled={disabled}
                      onChange={(event) =>
                        setTemplateRecurrence(event.target.value as Recurrence)
                      }
                    >
                      <option value="weekly">Каждую неделю</option>
                      <option value="monthly">Каждый месяц</option>
                      <option value="yearly">Каждый год</option>
                    </select>
                  </label>
                  <label>
                    Следующая дата
                    <input
                      type="date"
                      min="1900-01-01"
                      max="2100-12-31"
                      value={templateNextDate}
                      onChange={(event) => setTemplateNextDate(event.target.value)}
                      required
                      disabled={disabled}
                    />
                  </label>
                </>
              )}
            </div>
            <div className="form-actions">
              <button type="submit" disabled={disabled}>
                {templateEditingId ? 'Сохранить шаблон' : 'Создать шаблон'}
              </button>
              {templateEditingId && (
                <button type="button" className="secondary" onClick={resetTemplateForm}>
                  Отмена
                </button>
              )}
            </div>
          </form>
        )}

        {loaded && templates.length === 0 && !templateEditorOpen && (
          <p className="muted">
            Создай «Вода», «Шоколадка» или любую повторяющуюся оплату.
          </p>
        )}
        <div className="template-list">
          {templates.map((item) => {
            const due =
              item.templateKind === 'recurring' && !!item.nextDate && item.nextDate <= today()
            return (
              <article className={`template-item ${due ? 'due' : ''}`} key={item.id}>
                <button
                  type="button"
                  className="template-use"
                  disabled={disabled}
                  onClick={() => void useTemplate(item)}
                >
                  <span className="template-name">{item.title}</span>
                  <strong>
                    {item.type === 'income' ? '+' : '−'}
                    {money(item.amount)}
                  </strong>
                  <small>
                    {item.category}
                    {item.templateKind === 'recurring'
                      ? ` · ${
                          due
                            ? 'пора оплатить'
                            : `следующая ${item.nextDate?.split('-').reverse().join('.')}`
                        }`
                      : ''}
                  </small>
                </button>
                <div className="template-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Изменить шаблон: ${item.title}`}
                    disabled={disabled}
                    onClick={() => editTemplate(item)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-button delete"
                    aria-label={`Удалить шаблон: ${item.title}`}
                    disabled={disabled}
                    onClick={() => void removeTemplate(item)}
                  >
                    ×
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <div className="columns">
        <section className="card">
          <div className="section-heading">
            <h2>Операции</h2>
            <span className="badge">{visible.length} записей</span>
          </div>

          <label style={{ marginBottom: 18 }}>
            Поиск по операциям
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Название, категория, место или комментарий"
            />
          </label>
          {search && (
            <small style={{ marginBottom: 12 }}>
              Показатели и график рассчитаны по найденным операциям.
            </small>
          )}
          {loaded && visible.length === 0 && (
            <p className="muted">За выбранный период операций нет.</p>
          )}

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Операция</th>
                  <th className="align-right">Сумма</th>
                  <th>
                    <span className="sr-only">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id}>
                    <td className="date-cell">{item.date.split('-').reverse().join('.')}</td>
                    <td>
                      <strong>{item.title}</strong>
                      <small>
                        {item.type === 'income' ? 'Доход' : 'Расход'}
                        {' · '}
                        {item.category}
                      </small>
                      {(item.counterparty || item.subcategory) && (
                        <small>
                          {[item.counterparty, item.subcategory].filter(Boolean).join(' · ')}
                        </small>
                      )}
                      {item.note && item.note !== item.title && (
                        <details className="operation-details">
                          <summary>Комментарий</summary>
                          {item.note}
                        </details>
                      )}
                    </td>
                    <td className={`price ${item.type === 'income' ? 'positive' : ''}`}>
                      {item.type === 'income' ? '+' : '−'}
                      {money(item.amount)}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Редактировать: ${item.title}`}
                          disabled={disabled}
                          onClick={() => edit(item)}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="icon-button delete"
                          aria-label={`Удалить: ${item.title}`}
                          disabled={disabled}
                          onClick={() => void remove(item)}
                        >
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h2>Расходы по категориям</h2>
          {loaded && breakdown.length === 0 && (
            <p className="muted">За выбранный период расходов нет.</p>
          )}
          {breakdown.map((item) => (
            <div className="chart-row" key={item.name}>
              <div className="chart-label">
                <span>{item.name}</span>
                <strong>{money(item.amount)}</strong>
              </div>
              <div className="track">
                <div className="bar" style={{ width: `${(item.amount / maximum) * 100}%` }} />
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  )
}
