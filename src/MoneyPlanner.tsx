import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, money, today } from './api'
import './planning.css'
import { projectMoney, nextRentDate, cashAtNextRent, firstTargetMonth } from './moneyProjection'
import type { MoneySettings, PlannedShift } from './moneyProjection'
const defaults: MoneySettings = { balance: 0, netPerShift: 4600, shiftsPerMonth: 12, monthlySpending: 15000, rent: 20000, rentDay: 1, savingsTarget: 100000, purchasePrice: 40000 }
const shiftInitial = () => ({ date: today(), expectedPay: '', note: '', received: false })
const monthName = (s: string) => new Date(`${s}-01T12:00:00`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
export default function MoneyPlanner() {
  const [settings, setSettings] = useState<MoneySettings | null>(null)
  const [draft, setDraft] = useState<MoneySettings>(defaults)
  const [shifts, setShifts] = useState<PlannedShift[]>([])
  const [shift, setShift] = useState(shiftInitial)
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    const [s, rows] = await Promise.all([api<MoneySettings | null>('/api/finance-settings'), api<PlannedShift[]>('/api/planned-shifts')])
    setSettings(s); if (s) setDraft(s); setShifts(rows)
  }
  useEffect(() => { void load().catch((e) => setError(e.message)) }, [])
  const set = (key: keyof MoneySettings, value: string) => setDraft((s) => ({ ...s, [key]: Number(value) }))
  async function saveSettings(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { const saved = await api<MoneySettings>('/api/finance-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }); setSettings(saved); setNotice('Параметры прогноза сохранены.') }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function saveShift(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { await api(editId ? `/api/planned-shifts/${editId}` : '/api/planned-shifts', { method: editId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...shift, expectedPay: Number(shift.expectedPay) }) }); setShift(shiftInitial()); setEditId(null); await load() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function toggleReceived(x: PlannedShift) {
    try { await api(`/api/planned-shifts/${x.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: x.date, expectedPay: Number(x.expectedPay), note: x.note, received: !x.received }) }); await load() }
    catch (e) { setError((e as Error).message) }
  }
  async function remove(id: string) {
    if (!confirm('Удалить запланированную смену?')) return
    try { await api(`/api/planned-shifts/${id}`, { method: 'DELETE' }); await load() }
    catch (e) { setError((e as Error).message) }
  }
  const now = today()
  const forecast = settings ? projectMoney(settings, shifts, now) : []
  const withPurchase = settings ? projectMoney(settings, shifts, now, true) : []
  const due = settings ? nextRentDate(now, settings.rentDay) : ''
  const remainingAfterRent = settings ? cashAtNextRent(settings, shifts, now) : 0
  return <section className="card planning-panel"><div className="section-heading"><div><span className="kicker">СЦЕНАРИЙ</span><h2>Смены и цели по деньгам</h2></div></div>
    <p className="muted">Введи доступный остаток и ожидаемые суммы. Отмечай полученные выплаты и обновляй остаток: они выйдут из прогноза.</p>
    {error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success">{notice}</p>}
    <form onSubmit={(e) => void saveSettings(e)}><div className="planning-fields">
      {([['balance','Доступно сейчас, ₽'],['netPerShift','Обычно чистыми за смену, ₽'],['shiftsPerMonth','Смен в будущем месяце'],['monthlySpending','Прочие траты в месяц, ₽'],['rent','Квартира в месяц, ₽'],['rentDay','День оплаты квартиры'],['savingsTarget','Цель подушки, ₽'],['purchasePrice','Покупка (например, телефон), ₽']] as [keyof MoneySettings,string][]).map(([key,label]) => <label key={key}>{label}<input required type="number" min={key === 'rentDay' ? 1 : 0} max={key === 'rentDay' || key === 'shiftsPerMonth' ? 31 : 999999999.99} step={key === 'rentDay' || key === 'shiftsPerMonth' ? 1 : 0.01} value={draft[key]} onChange={(e) => set(key, e.target.value)} /></label>)}
    </div><button disabled={busy}>{settings ? 'Обновить расчёт' : 'Сохранить и рассчитать'}</button></form>
    <h3>Запланированные смены</h3><p className="muted">Для расчёта укажи день, когда ожидаешь оплату. Смены с прошедшей датой и без отметки «Получено» остаются в списке, но в прогноз не входят: перенеси дату, если выплата задержалась.</p><form onSubmit={(e) => void saveShift(e)}><div className="planning-fields"><label>Дата ожидаемой оплаты<input required type="date" value={shift.date} onChange={(e) => setShift({ ...shift, date: e.target.value })} /></label><label>Ожидаю чистыми, ₽<input required type="number" min="0" step="0.01" value={shift.expectedPay} onChange={(e) => setShift({ ...shift, expectedPay: e.target.value })} /></label></div><label>Примечание<input maxLength={1000} value={shift.note} onChange={(e) => setShift({ ...shift, note: e.target.value })} /></label><label><input type="checkbox" checked={shift.received} onChange={(e) => setShift({ ...shift, received: e.target.checked })} /> Оплата уже получена</label><div className="form-actions"><button disabled={busy}>{editId ? 'Сохранить смену' : '+ Запланировать смену'}</button>{editId && <button type="button" className="secondary" onClick={() => { setEditId(null); setShift(shiftInitial()) }}>Отмена</button>}</div></form>
    <div className="planning-list">{shifts.slice().sort((a,b) => b.date.localeCompare(a.date)).map((x) => <div className="planning-row" key={x.id}><div><strong>{x.date} · {money(Number(x.expectedPay))}{x.received ? ' · получено' : ''}</strong>{x.note && <p>{x.note}</p>}</div><div className="form-actions"><button className="secondary" onClick={() => void toggleReceived(x)}>{x.received ? 'Вернуть в план' : 'Получено'}</button><button className="secondary" onClick={() => { setEditId(x.id); setShift({ date: x.date, expectedPay: String(x.expectedPay), note: x.note, received: x.received }) }}>Изменить</button><button className="secondary" onClick={() => void remove(x.id)}>×</button></div></div>)}</div>
    {settings && <><div className="planning-metrics"><div><span>На квартиру к {due}</span><strong>{money(remainingAfterRent)}</strong><small>{remainingAfterRent >= 0 ? 'После оплаты хватает по этому плану' : `Не хватает ${money(-remainingAfterRent)}`}</small></div><div><span>Подушка {money(settings.savingsTarget)}</span><strong>{firstTargetMonth(forecast, settings.savingsTarget) ? monthName(firstTargetMonth(forecast, settings.savingsTarget)!) : 'Позже 12 месяцев'}</strong></div><div><span>Если купить за {money(settings.purchasePrice)} сейчас</span><strong>{firstTargetMonth(withPurchase, settings.savingsTarget) ? monthName(firstTargetMonth(withPurchase, settings.savingsTarget)!) : 'Позже 12 месяцев'}</strong><small>Остаток сразу после покупки: {money(settings.balance - settings.purchasePrice)}</small></div></div>
      <p className="muted">В текущем месяце учтены только запланированные смены и оставшаяся доля прочих расходов. Со следующего месяца — {settings.shiftsPerMonth} смен по {money(settings.netPerShift)}, прочие траты и квартира. Это сценарий, а не обещание дохода. Регулярные операции из списка выше сюда отдельно не прибавляются.</p>
      <div className="table-scroll"><table><thead><tr><th>Месяц</th><th>Доход от смен</th><th>Траты</th><th>Остаток</th></tr></thead><tbody>{forecast.map((x) => <tr key={x.month}><td>{monthName(x.month)}</td><td>{money(x.earnings)}</td><td>{money(x.spending)}</td><td>{money(x.balance)}</td></tr>)}</tbody></table></div>
    </>}
  </section>
}
