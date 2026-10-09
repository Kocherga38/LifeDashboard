import { useEffect, useState } from 'react'
import { api, num, today } from './api'
import { nutrients } from '../shared/journals'
import type { Entry } from '../shared/journals'

type Item = { name: string; grams: number }
type Template = { id: string; title: string; items: Item[] }
type Props = { products: Entry[]; meals: Entry[]; onAdded: (items: Entry[]) => void }

export default function MealTemplates({ products, meals, onAdded }: Props) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [selected, setSelected] = useState('')
  const [title, setTitle] = useState('')
  const [items, setItems] = useState<Item[]>([{ name: '', grams: 50 }])
  const [editing, setEditing] = useState<string | null>(null)
  const [date, setDate] = useState(today())
  const [meal, setMeal] = useState('Завтрак')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [sourceDate, setSourceDate] = useState(today())
  const [sourceMeal, setSourceMeal] = useState('Завтрак')
  const [selectedEntries, setSelectedEntries] = useState<string[]>([])

  useEffect(() => {
    api<Template[]>('/api/meal-templates').then(setTemplates).catch(e => setError(e.message))
  }, [])
  const template = templates.find(t => t.id === selected)
  const [draft, setDraft] = useState<Item[]>([])
  useEffect(() => { setDraft(template?.items.map(x => ({...x})) ?? []) }, [template])
  const lookup = new Map(products.map(p => [String(p.name), p]))
  const totals = (list: Item[]) => Object.fromEntries(nutrients.map(n => [
    n, list.reduce((sum, item) => sum + Number(lookup.get(item.name)?.[n] ?? 0) * item.grams / 100, 0)
  ]))
  const candidateEntries = meals.filter(m => m.date === sourceDate && m.meal === sourceMeal)
  function startEdit(t: Template) {
    setEditing(t.id); setTitle(t.title); setItems(t.items.map(i=>({...i})))
  }
  function resetEditor() { setEditing(null); setTitle(''); setItems([{name:'',grams:50}]) }
  async function submit() {
    setBusy(true); setError(''); setNotice('')
    try {
      if (!items.length || items.some(i => !lookup.has(i.name) || !Number.isFinite(i.grams) || i.grams <= 0))
        throw new Error('Выбери продукты из справочника и положительные граммовки.')
      const result = await api<Template>(editing ? `/api/meal-templates/${editing}` : '/api/meal-templates',{
        method:editing ? 'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,items})
      })
      setTemplates(current => editing ? current.map(t=>t.id===editing?result:t):[...current,result])
      setSelected(result.id)
      resetEditor()
      setNotice('Шаблон сохранён.')
    } catch(e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function remove(t: Template) {
    if (!confirm(`Удалить шаблон «${t.title}»? История питания останется.`)) return
    setBusy(true); setError('')
    try {
      await api(`/api/meal-templates/${t.id}`,{method:'DELETE'})
      setTemplates(x=>x.filter(v=>v.id!==t.id))
      if(selected===t.id)setSelected('')
      if(editing===t.id)resetEditor()
    } catch(e) { setError((e as Error).message) } finally {setBusy(false)}
  }
  async function addMeal() {
    if(!template)return
    setBusy(true);setError('');setNotice('')
    try {
      const rows=await api<Entry[]>(`/api/meal-templates/${template.id}/use`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,meal,items:draft})
      })
      onAdded(rows);setNotice(`Добавлено продуктов: ${rows.length}.`)
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  function fromHistory() {
    const chosen=candidateEntries.filter(e=>selectedEntries.includes(e.id))
    if(!chosen.length){setError('Выбери продукты из истории.');return}
    setItems(chosen.map(e=>({name:String(e.name),grams:Number(e.grams)})))
    setEditing(null);setTitle(`${sourceMeal} ${sourceDate}`);setError('')
    setNotice('Продукты перенесены в редактор шаблона.')
  }
  return <section className="card" style={{marginBottom:24}}>
    <h2>Шаблоны питания</h2>
    <p className="muted">Сохрани любимый набор продуктов и добавляй его в дневник одним действием. Каждый продукт записывается отдельно.</p>
    {error && <p className="message error" role="alert">{error}</p>}
    {notice && <p className="message success" role="status">{notice}</p>}
    <div className="journal-form">
      <label>Шаблон
        <select value={selected} onChange={e=>setSelected(e.target.value)}>
          <option value="">Выбери шаблон</option>
          {templates.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </label>
      {template && <label>Приём пищи
        <select value={meal} onChange={e=>setMeal(e.target.value)}>
          {['Завтрак','Обед','Ужин','Перекус'].map(x=><option key={x}>{x}</option>)}
        </select>
      </label>}
      {template && <label>Дата<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>}
    </div>
    {template && <>
      <div className="journal-form">
        {draft.map((item,i)=><label key={i}>{item.name}, г
          <input type="number" min="0.01" step="any" value={item.grams} onChange={e=>setDraft(d=>d.map((x,j)=>i===j?{...x,grams:Number(e.target.value)}:x))}/>
        </label>)}
      </div>
      <p className="muted">{nutrients.map(n=>`${n==='kcal'?'Ккал':n==='protein'?'Б':n==='fat'?'Ж':n==='carbs'?'У':'Клетчатка'}: ${num(totals(draft)[n])}`).join(' · ')}</p>
      <div className="form-actions">
        <button type="button" disabled={busy || draft.some(i=>i.grams<=0 || !lookup.has(i.name))} onClick={()=>void addMeal()}>Добавить в дневник</button>
        <button type="button" className="secondary" disabled={busy} onClick={()=>startEdit(template)}>Изменить шаблон</button>
        <button type="button" className="secondary" disabled={busy} onClick={()=>void remove(template)}>Удалить</button>
      </div>
    </>}
    <div style={{marginTop:16}}>
      <h3>{editing?'Редактирование шаблона':'Создать новый шаблон'}</h3>
      <div className="journal-form" style={{marginTop:12}}>
        <label>Название<input value={title} maxLength={160} onChange={e=>setTitle(e.target.value)} placeholder="Йогурт, мюсли, банан и арахис"/></label>
      </div>
      {items.map((item,i)=><div className="journal-form" key={i}>
        <label>Продукт
          <select value={item.name} onChange={e=>setItems(a=>a.map((x,j)=>i===j?{...x,name:e.target.value}:x))}>
            <option value="">Выбери продукт</option>
            {products.map(p=><option key={p.id} value={String(p.name)}>{String(p.name)}</option>)}
          </select>
        </label>
        <label>Масса, г<input type="number" min="0.01" step="any" value={item.grams} onChange={e=>setItems(a=>a.map((x,j)=>i===j?{...x,grams:Number(e.target.value)}:x))}/></label>
        <button className="secondary" type="button" disabled={items.length===1} onClick={()=>setItems(a=>a.filter((_,j)=>j!==i))}>Убрать</button>
      </div>)}
      <p className="muted">{nutrients.map(n=>`${n==='kcal'?'Ккал':n==='protein'?'Б':n==='fat'?'Ж':n==='carbs'?'У':'Клетчатка'}: ${num(totals(items)[n])}`).join(' · ')}</p>
      <div className="form-actions">
        <button type="button" className="secondary" disabled={items.length>=40} onClick={()=>setItems(a=>[...a,{name:'',grams:50}])}>+ Продукт</button>
        <button type="button" disabled={busy || !title.trim()} onClick={()=>void submit()}>{editing?'Сохранить изменения':'Сохранить шаблон'}</button>
        {editing && <button type="button" className="secondary" onClick={resetEditor}>Отмена</button>}
      </div>
    </div>
    <details style={{marginTop:16}}>
      <summary>Создать шаблон из истории питания</summary>
      <div className="journal-form" style={{marginTop:12}}>
        <label>Дата<input type="date" value={sourceDate} onChange={e=>{setSourceDate(e.target.value);setSelectedEntries([])}}/></label>
        <label>Приём пищи<select value={sourceMeal} onChange={e=>{setSourceMeal(e.target.value);setSelectedEntries([])}}>
          {['Завтрак','Обед','Ужин','Перекус'].map(x=><option key={x}>{x}</option>)}
        </select></label>
      </div>
      {candidateEntries.map(e=><label key={e.id} style={{display:'block',margin:'8px 0'}}>
        <input type="checkbox" checked={selectedEntries.includes(e.id)} onChange={v=>setSelectedEntries(a=>v.target.checked?[...a,e.id]:a.filter(id=>id!==e.id))}/>
        {' '}{String(e.name)} — {num(Number(e.grams))} г
      </label>)}
      {!candidateEntries.length && <p className="muted">За этот приём пищи записей нет.</p>}
      <button type="button" className="secondary" disabled={!selectedEntries.length} onClick={fromHistory}>Перенести в шаблон</button>
    </details>
  </section>
}
