import { useEffect, useState } from 'react'
import { api, today, money } from './api'

type Preview = {
  filename: string
  imported: boolean
  counts: Record<string, number>
  issues: { sheet: string; row: number; message: string }[]
  summary: Record<string, { income: number; expense: number; count: number }>
  budgetTemplate: { category: string; amount: number }[]
}
const labels: Record<string, string> = {
  operations: 'Денежные операции',
  products: 'Продукты',
  shifts: 'Смены',
  weights: 'Взвешивания',
  measurements: 'Замеры',
  meals: 'Записи питания',
  workouts: 'Тренировки'
}
export default function DataPage() {
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [month, setMonth] = useState(today().slice(0, 7))
  function load() {
    return api<Preview>('/api/import/preview').then(setPreview)
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message))
  }, [])
  async function apply() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api('/api/import/apply', { method: 'POST' })
      await load()
      setNotice('Импорт завершён. Открой нужный раздел — записи уже в базе.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function template() {
    if (busy || !month) return
    setBusy(true)
    setError('')
    try {
      const r = await api<{ added: number }>('/api/budget-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month })
      })
      setNotice(`Добавлено лимитов: ${r.added}. Существующие лимиты не изменены.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">LIFE / ТВОИ ДАННЫЕ</p>
          <h1>Переезд из Excel</h1>
          <p className="muted">Импорт подготовленной таблицы и выгрузка данных приложения.</p>
        </div>
        <a className="download-button" href="/api/export">
          Скачать данные JSON
        </a>
      </header>
      {error && (
        <p className="message error" role="alert">
          {error}{' '}
          <button
            className="secondary"
            onClick={() =>
              void load()
                .then(() => setError(''))
                .catch((e) => setError(e.message))
            }
          >
            Повторить
          </button>
        </p>
      )}
      {notice && (
        <p className="message success" role="status">
          {notice}
        </p>
      )}
      {!preview && !error && <p>Читаем сведения об импорте…</p>}
      {preview && (
        <>
          <section className="card">
            <div className="section-heading">
              <h2>{preview.filename}</h2>
              <span className="badge">
                {preview.imported ? 'Импорт выполнен' : 'Готова к переносу'}
              </span>
            </div>
            <div className="import-counts">
              {Object.entries(preview.counts).map(([key, count]) => (
                <div key={key}>
                  <strong>{count}</strong>
                  <small>{labels[key] ?? key}</small>
                </div>
              ))}
            </div>
            <p className="muted">
              Переносятся исходные записи, категории, комментарии и значения продуктов. Сводные
              формулы пересчитываются в приложении.
            </p>
            <p className="muted">
              Смены хранятся отдельно от денежных операций. Существующие записи сохраняются;
              повторный импорт этого файла не добавит их заново.
            </p>
            <button disabled={busy || preview.imported} onClick={() => void apply()}>
              {busy
                ? 'Переносим…'
                : preview.imported
                  ? 'Данные уже перенесены'
                  : 'Импортировать в приложение'}
            </button>
          </section>
          <section className="card journal-chart">
            <h2>Контрольные суммы денежных операций</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Месяц</th>
                    <th>Записей</th>
                    <th>Доходы</th>
                    <th>Расходы</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(preview.summary)
                    .sort()
                    .map(([key, v]) => (
                      <tr key={key}>
                        <td>{key}</td>
                        <td>{v.count}</td>
                        <td>{money(v.income)}</td>
                        <td>{money(v.expense)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <small>
              Это суммы из Excel. Если в базе уже есть свои операции, общие итоги будут отличаться.
            </small>
          </section>
          <section className="card journal-chart">
            <h2>Бюджет из Excel</h2>
            <p className="muted">
              В таблице заданы общие месячные лимиты без даты. Выбери, к какому месяцу их применить.
            </p>
            <div className="period">
              <label>
                Месяц
                <input
                  type="month"
                  min="1900-01"
                  max="2100-12"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  disabled={busy}
                />
              </label>
              <button disabled={busy || !month} onClick={() => void template()}>
                Применить {preview.budgetTemplate.length} лимитов
              </button>
            </div>
          </section>
          <section className="card journal-chart">
            <h2>Неполные строки · {preview.issues.length}</h2>
            <p className="muted">
              Эти строки не добавлены в расчёты. Исходная таблица находится в папке data архива.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Лист</th>
                    <th>Строка</th>
                    <th>Причина</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.issues.map((issue, i) => (
                    <tr key={i}>
                      <td>{issue.sheet}</td>
                      <td>{issue.row}</td>
                      <td>{issue.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  )
}
