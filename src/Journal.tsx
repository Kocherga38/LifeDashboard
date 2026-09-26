import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'
import { journals, nutrients, nutrientLabels, validateEntry } from '../shared/journals'
import type { Kind, Entry, Field } from '../shared/journals'
import { api, today, money, num } from './api'

const value = (entry: Entry, key: string) => Number(entry[key] ?? 0)
const sets = (entry: Entry) => (Array.isArray(entry.sets) ? (entry.sets as number[]) : [])
const reps = (entry: Entry) => sets(entry).reduce((a, b) => a + b, 0)
const shiftNet = (entry: Entry) => value(entry, 'pay') - value(entry, 'cost') - value(entry, 'tax')
const shiftHours = (entry: Entry) =>
  value(entry, 'hours') + value(entry, 'travelOut') + value(entry, 'travelBack')
const completeShift = (entry: Entry) =>
  ['travelOut', 'travelBack', 'cost', 'tax'].every(
    (k) => entry[k] !== null && entry[k] !== undefined
  )

function makeForm(kind: Kind) {
  return Object.fromEntries(
    journals[kind].fields.map((f) => [
      f.key,
      f.type === 'date' && !f.optional ? today() : (f.options?.[0] ?? '')
    ])
  )
}
export default function Journal({ kind }: { kind: Kind }) {
  const meta = journals[kind]
  const [rows, setRows] = useState<Entry[]>([]),
    [products, setProducts] = useState<Entry[]>([])
  const [form, setForm] = useState<Record<string, string>>(() => makeForm(kind))
  const [editId, setEditId] = useState<string | null>(null),
    [month, setMonth] = useState(''),
    [day, setDay] = useState(today())
  const [exercise, setExercise] = useState(''),
    [goals, setGoals] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reload, setReload] = useState(0)
  const lock = useRef(false),
    editor = useRef<HTMLDivElement>(null)
  const [mealDetails, setMealDetails] = useState(false)
  useEffect(() => {
    const c = new AbortController()
    setLoading(true)
    setReady(false)
    setError('')
    Promise.all([
      api<Entry[]>(`/api/journal/${kind}`, { signal: c.signal }),
      kind === 'meals'
        ? api<Entry[]>('/api/journal/products', { signal: c.signal })
        : Promise.resolve([]),
      kind === 'meals'
        ? api<Record<string, number>>('/api/goals', { signal: c.signal })
        : Promise.resolve({})
    ])
      .then(([data, p, g]) => {
        if (c.signal.aborted) return
        setRows(data)
        setProducts(p)
        setGoals(g)
        setReady(true)
        if (kind === 'workouts') setExercise(String(data[0]?.name ?? ''))
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message)
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false)
      })
    return () => c.abort()
  }, [kind, reload])
  const disabled = !ready || busy
  const selected = rows.filter(
    (r) =>
      (!month || String(r.date ?? '').startsWith(month)) &&
      (kind !== 'workouts' || !exercise || r.name === exercise)
  )
  const chronological = [...selected].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const dailyMeals = rows.filter((r) => r.date === day)
  const mealTotals = Object.fromEntries(
    nutrients.map((n) => [
      n,
      dailyMeals.reduce((s, r) => s + (value(r, n) * value(r, 'grams')) / 100, 0)
    ])
  )
  const complete = selected.filter(completeShift)
  const exerciseNames = Array.from(new Set(rows.map((r) => String(r.name ?? '')))).filter(Boolean)
  let cards: { label: string; text: string }[] = []
  if (kind === 'shifts')
    cards = [
      { label: 'Оплата смен', text: money(selected.reduce((s, r) => s + value(r, 'pay'), 0)) },
      {
        label: 'Чистыми · полные записи',
        text: money(complete.reduce((s, r) => s + shiftNet(r), 0))
      },
      {
        label: 'Чистая ставка с дорогой',
        text: complete.length
          ? `${money(complete.reduce((s, r) => s + shiftNet(r), 0) / complete.reduce((s, r) => s + shiftHours(r), 0))}/ч`
          : 'Нет полных записей'
      }
    ]
  if (kind === 'weights')
    cards = [
      {
        label: 'Последний вес',
        text: chronological.length ? `${num(value(chronological.at(-1)!, 'weight'))} кг` : '—'
      },
      {
        label: 'Изменение за период',
        text:
          chronological.length > 1
            ? `${num(value(chronological.at(-1)!, 'weight') - value(chronological[0], 'weight'))} кг`
            : '—'
      },
      { label: 'Взвешиваний', text: String(selected.length) }
    ]
  if (kind === 'workouts')
    cards = [
      { label: 'Тренировок упражнения', text: String(selected.length) },
      { label: 'Всего повторений', text: String(selected.reduce((s, r) => s + reps(r), 0)) },
      { label: 'Лучший подход', text: String(Math.max(0, ...selected.flatMap(sets))) }
    ]
  const chart = chronological.map((r) => {
    const base = {
      date: r.date,
      value:
        kind === 'weights'
          ? value(r, 'weight')
          : kind === 'workouts'
            ? reps(r)
            : kind === 'shifts'
              ? completeShift(r)
                ? shiftNet(r) / shiftHours(r)
                : null
              : value(r, 'waist')
    }
    if (kind !== 'weights') return base
    const ts = Date.parse(String(r.date))
    const last7 = rows.filter(
      (v) => Date.parse(String(v.date)) <= ts && Date.parse(String(v.date)) > ts - 7 * 86400000
    )
    return { ...base, average: last7.reduce((s, v) => s + value(v, 'weight'), 0) / last7.length }
  })
  function change(key: string, v: string) {
    setForm((current) => {
      const next = { ...current, [key]: v }
      if (kind === 'meals' && key === 'name') {
        const product = products.find((p) => p.name === v)
        if (product) {
          for (const n of nutrients) next[n] = String(product[n])
        } else if (products.some((p) => p.name === current.name)) {
          for (const n of nutrients) next[n] = ''
        }
      }
      return next
    })
  }
  function reset() {
    setEditId(null)
    setForm(makeForm(kind))
    setMealDetails(false)
  }
  function fill(row: Entry, repeat = false) {
    setEditId(repeat ? null : row.id)
    setError('')
    setNotice('')
    setForm(
      Object.fromEntries(
        meta.fields.map((f) => [
          f.key,
          repeat && f.key === 'date'
            ? today()
            : Array.isArray(row[f.key])
              ? (row[f.key] as number[]).join(' ')
              : String(row[f.key] ?? '')
        ])
      )
    )
    editor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  async function save(e: FormEvent) {
    e.preventDefault()
    if (disabled || lock.current) return
    let data: Record<string, unknown>
    try {
      data = validateEntry(
        kind,
        Object.fromEntries(
          meta.fields.map((f) => [
            f.key,
            f.type === 'number'
              ? form[f.key] === ''
                ? null
                : Number(form[f.key].replace(',', '.'))
              : f.type === 'sets'
                ? form[f.key]
                    .trim()
                    .split(/[\s,;]+/)
                    .map(Number)
                : form[f.key]
          ])
        )
      )
    } catch (e) {
      setError((e as Error).message)
      if (kind === 'meals') setMealDetails(true)
      return
    }
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const saved = await api<Entry>(`/api/journal/${kind}${editId ? `/${editId}` : ''}`, {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      setRows((current) =>
        editId ? current.map((r) => (r.id === editId ? saved : r)) : [saved, ...current]
      )
      reset()
      setNotice('Запись сохранена.')
      if (saved.date) {
        setDay(saved.date)
        if (month && !saved.date.startsWith(month)) setMonth(saved.date.slice(0, 7))
      }
      if (kind === 'workouts') setExercise(String(saved.name))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function remove(row: Entry) {
    if (disabled || lock.current || !confirm('Удалить эту запись?')) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await api(`/api/journal/${kind}/${row.id}`, { method: 'DELETE' })
      setRows((c) => c.filter((r) => r.id !== row.id))
      if (editId === row.id) reset()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function saveGoals() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      await api('/api/goals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(nutrients.map((n) => [n, Number(goals[n] ?? 0)])))
      })
      setNotice('Цели сохранены.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  function renderField(f: Field) {
    return (
      <label key={f.key}>
        {f.label}
        {f.optional ? ' · необязательно' : ''}
        {f.options ? (
          <select
            value={form[f.key]}
            disabled={disabled}
            onChange={(e) => change(f.key, e.target.value)}
          >
            {f.options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        ) : (
          <input
            type={f.type === 'sets' ? 'text' : (f.type ?? 'text')}
            list={kind === 'meals' && f.key === 'name' ? 'food-products' : undefined}
            value={form[f.key] ?? ''}
            min={f.type === 'date' ? '1900-01-01' : (f.min ?? 0)}
            max={f.type === 'date' ? '2100-12-31' : f.max}
            step={f.type === 'number' ? 'any' : undefined}
            required={!f.optional}
            disabled={disabled}
            onChange={(e) => change(f.key, e.target.value)}
          />
        )}
      </label>
    )
  }
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">TRELLIS / ЛИЧНЫЙ ЖУРНАЛ</p>
          <h1>{meta.title}</h1>
          <p className="muted">{meta.description}</p>
        </div>
        <div className="period">
          {kind !== 'products' && (
            <label>
              Период
              <input
                type="month"
                value={month}
                min="1900-01"
                max="2100-12"
                onChange={(e) => setMonth(e.target.value)}
              />
            </label>
          )}
          <button className="secondary" onClick={() => setMonth('')}>
            Всё время
          </button>
          <button
            className="secondary"
            disabled={busy || loading}
            onClick={() => setReload((n) => n + 1)}
          >
            Обновить
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="message success">
          {notice}
        </p>
      )}
      {loading && <p>Загружаем записи…</p>}
      {kind === 'workouts' && (
        <label className="exercise-filter">
          Упражнение
          <select value={exercise} onChange={(e) => setExercise(e.target.value)}>
            <option value="">Все упражнения</option>
            {exerciseNames.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      )}
      {ready && cards.length > 0 && (
        <section className="summary">
          {cards.map((c) => (
            <article className="card" key={c.label}>
              <p className="muted">{c.label}</p>
              <div className="big-number">{c.text}</div>
            </article>
          ))}
        </section>
      )}
      {ready && kind === 'shifts' && (
        <p className="muted journal-hint">
          Смены не добавляются повторно в денежные операции.{' '}
          {selected.length - complete.length > 0
            ? `${selected.length - complete.length} записей с незаполненными расходами, налогом или дорогой исключены из чистой ставки. Впиши 0, если затрат не было.`
            : ''}
        </p>
      )}
      {ready && kind === 'meals' && (
        <section className="card meal-summary">
          <div className="section-heading">
            <h2>Питание за день</h2>
            <input
              aria-label="День питания"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </div>
          <div className="nutrient-grid">
            {nutrients.map((n, i) => (
              <div key={n}>
                <p className="muted">{nutrientLabels[i]}</p>
                <strong>{num(mealTotals[n])}</strong>
                <small>Цель: {goals[n] === undefined ? 'не задана' : num(goals[n])}</small>
              </div>
            ))}
          </div>
          <details>
            <summary>Изменить свои цели</summary>
            <div className="nutrient-grid">
              {nutrients.map((n, i) => (
                <label key={n}>
                  {nutrientLabels[i]}
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    step="any"
                    value={goals[n] ?? ''}
                    onChange={(e) => setGoals((g) => ({ ...g, [n]: Number(e.target.value) }))}
                  />
                </label>
              ))}
            </div>
            <button disabled={busy} onClick={() => void saveGoals()}>
              Сохранить цели
            </button>
          </details>
        </section>
      )}
      <section ref={editor} className={`card form-card ${editId ? 'editing' : ''}`}>
        <h2>{editId ? 'Редактировать запись' : 'Добавить запись'}</h2>
        <form onSubmit={save} noValidate>
          <div className="journal-form">
            {meta.fields
              .filter((f) => kind !== 'meals' || ['date', 'meal', 'name', 'grams'].includes(f.key))
              .map(renderField)}
          </div>
          {kind === 'meals' && (
            <>
              <div className="meal-preview">
                {nutrients.map((n, i) => (
                  <span key={n}>
                    {nutrientLabels[i]} в порции:{' '}
                    <strong>
                      {form[n] !== '' && form.grams !== ''
                        ? num((Number(form[n]) * Number(form.grams)) / 100)
                        : '—'}
                    </strong>
                  </span>
                ))}
              </div>
              <details open={mealDetails} onToggle={(e) => setMealDetails(e.currentTarget.open)}>
                <summary>Время, комментарий и пищевая ценность на 100 г</summary>
                <div className="journal-form detail-fields">
                  {meta.fields
                    .filter((f) => !['date', 'meal', 'name', 'grams'].includes(f.key))
                    .map(renderField)}
                </div>
              </details>
            </>
          )}
          <datalist id="food-products">
            {products.map((p) => (
              <option key={p.id} value={String(p.name)} />
            ))}
          </datalist>
          <div className="form-actions">
            <button disabled={disabled}>
              {busy ? 'Сохраняем…' : editId ? 'Сохранить изменения' : 'Добавить'}
            </button>
            {editId && (
              <button type="button" className="secondary" disabled={busy} onClick={reset}>
                Отмена
              </button>
            )}
          </div>
        </form>
        {kind === 'meals' && (
          <small>
            Нутриенты указаны на 100 г. Их значения сохраняются с приёмом пищи: изменение
            справочника не перепишет историю.
          </small>
        )}
      </section>
      {ready && chart.length > 0 && ['weights', 'shifts', 'workouts'].includes(kind) && (
        <section className="card journal-chart">
          <h2>
            {kind === 'weights'
              ? 'Вес и среднее за 7 дней'
              : kind === 'shifts'
                ? 'Чистая ставка с дорогой, ₽/ч'
                : 'Повторения за тренировку'}
          </h2>
          {kind === 'workouts' && !exercise ? (
            <p className="muted">Выбери упражнение, чтобы сравнить его тренировки.</p>
          ) : (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart}>
                  <CartesianGrid stroke="#3a4a3e" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    stroke="#a5b5a6"
                    tickFormatter={(d) => String(d).slice(5).split('-').reverse().join('.')}
                  />
                  <YAxis
                    stroke="#a5b5a6"
                    domain={kind === 'weights' ? ['auto', 'auto'] : [0, 'auto']}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#203027',
                      border: '1px solid #465a48',
                      color: '#e8f0e9',
                      borderRadius: 12
                    }}
                    formatter={(v) => (v === null ? 'Не заполнено' : num(Number(v)))}
                  />
                  <Line
                    animationDuration={300}
                    dataKey="value"
                    name={kind === 'weights' ? 'Вес, кг' : kind === 'shifts' ? '₽/ч' : 'Повторения'}
                    stroke="#a5cf87"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    connectNulls={false}
                  />
                  {kind === 'weights' && (
                    <Line
                      animationDuration={300}
                      dataKey="average"
                      name="Среднее за 7 дней"
                      stroke="#b599d4"
                      strokeWidth={2}
                    />
                  )}
                  <Legend />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      )}
      {ready && (
        <section className="card journal-table">
          <h2>История · {selected.length}</h2>
          {selected.length === 0 ? (
            <p className="muted">
              Записей пока нет. Добавь первую запись выше.
            </p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {meta.fields.map((f) => (
                      <th key={f.key}>{f.label.split(':')[0]}</th>
                    ))}
                    {kind === 'meals' && <th>Ккал в порции</th>}
                    {kind === 'shifts' && <th>Чистыми</th>}
                    {kind === 'workouts' && <th>Всего</th>}
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.map((r) => (
                    <tr key={r.id}>
                      {meta.fields.map((f) => (
                        <td key={f.key} className={f.key === 'note' ? 'note-cell' : ''}>
                          {r[f.key] === null || r[f.key] === undefined || r[f.key] === ''
                            ? '—'
                            : Array.isArray(r[f.key])
                              ? (r[f.key] as number[]).join(' / ')
                              : typeof r[f.key] === 'number'
                                ? num(r[f.key] as number)
                                : String(r[f.key])}
                        </td>
                      ))}
                      {kind === 'meals' && (
                        <td>{num((value(r, 'kcal') * value(r, 'grams')) / 100)}</td>
                      )}
                      {kind === 'shifts' && (
                        <td>{completeShift(r) ? money(shiftNet(r)) : 'Не все затраты'}</td>
                      )}
                      {kind === 'workouts' && <td>{reps(r)}</td>}
                      <td>
                        <div className="row-actions">
                          <button
                            className="icon-button"
                            aria-label="Редактировать запись"
                            disabled={busy}
                            onClick={() => fill(r)}
                          >
                            ✎
                          </button>
                          <button
                            className="icon-button"
                            title="Повторить сегодня"
                            aria-label="Повторить запись"
                            disabled={busy}
                            onClick={() => fill(r, true)}
                          >
                            ＋
                          </button>
                          <button
                            className="icon-button delete"
                            aria-label="Удалить запись"
                            disabled={busy}
                            onClick={() => void remove(r)}
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
          )}
        </section>
      )}
      {kind === 'shifts' && <ShiftSimulator />}
    </main>
  )
}

function ShiftSimulator() {
  const [pay, setPay] = useState(5000),
    [hours, setHours] = useState(12),
    [road, setRoad] = useState(3),
    [cost, setCost] = useState(200),
    [tax, setTax] = useState(0),
    [count, setCount] = useState(15)
  const net = pay - cost - tax
  return (
    <section className="card journal-chart">
      <h2>Симулятор месяца</h2>
      <p className="muted">Сценарий для сравнения вариантов работы. Не добавляет записи в учёт.</p>
      <div className="journal-form">
        {[
          { label: 'Оплата смены, ₽', value: pay, set: setPay },
          { label: 'Часы смены', value: hours, set: setHours },
          { label: 'Дорога туда-обратно, ч', value: road, set: setRoad },
          { label: 'Расходы на смену, ₽', value: cost, set: setCost },
          { label: 'Налог за смену, ₽', value: tax, set: setTax },
          { label: 'Количество смен', value: count, set: setCount }
        ].map((f) => (
          <label key={f.label}>
            {f.label}
            <input
              type="number"
              min="0"
              value={f.value}
              onChange={(e) => f.set(Math.max(0, Number(e.target.value)))}
            />
          </label>
        ))}
      </div>
      <div className="sim-result">
        <strong>{money(net * count)} чистыми</strong>
        <span>{num((hours + road) * count)} часов с дорогой</span>
        <span>{hours + road > 0 ? money(net / (hours + road)) : '—'} / ч</span>
      </div>
    </section>
  )
}
