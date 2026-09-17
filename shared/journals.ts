export type Kind = 'shifts' | 'weights' | 'measurements' | 'products' | 'meals' | 'workouts'
export type Entry = Record<string, unknown> & { id: string; date?: string; name?: string }
export type Field = {
  key: string
  label: string
  type?: 'date' | 'time' | 'number' | 'text' | 'sets'
  optional?: boolean
  min?: number
  max?: number
  options?: string[]
}
export const nutrients = ['kcal', 'protein', 'fat', 'carbs', 'fiber'] as const
export const nutrientLabels = ['Ккал', 'Белки, г', 'Жиры, г', 'Углеводы, г', 'Клетчатка, г']
const date: Field = { key: 'date', label: 'Дата', type: 'date' }
const note: Field = { key: 'note', label: 'Комментарий', optional: true }
const nutrientFields: Field[] = nutrients.map((key, i) => ({
  key,
  label: `${nutrientLabels[i]} / 100 г`,
  type: 'number',
  min: 0,
  max: 1000
}))
export const journals: Record<Kind, { title: string; description: string; fields: Field[] }> = {
  shifts: {
    title: 'Смены',
    description: 'Оплата, дорога и чистая ставка за всё потраченное время.',
    fields: [
      date,
      { key: 'name', label: 'Место работы' },
      { key: 'pay', label: 'Оплата, ₽', type: 'number', min: 0, max: 999999999 },
      { key: 'hours', label: 'Часы смены', type: 'number', min: 0.01, max: 72 },
      { key: 'travelOut', label: 'Дорога туда, ч', type: 'number', optional: true, max: 72 },
      { key: 'travelBack', label: 'Дорога обратно, ч', type: 'number', optional: true, max: 72 },
      { key: 'cost', label: 'Расходы на смену, ₽', type: 'number', optional: true, max: 999999999 },
      { key: 'tax', label: 'Налог, ₽', type: 'number', optional: true, max: 999999999 },
      {
        key: 'status',
        label: 'Выплата',
        options: ['выплачено', 'ожидается', 'частично', 'не указан']
      },
      { key: 'paidDate', label: 'Дата выплаты', type: 'date', optional: true },
      note
    ]
  },
  weights: {
    title: 'Вес',
    description: 'История взвешиваний и среднее по измерениям за последние 7 календарных дней.',
    fields: [date, { key: 'weight', label: 'Вес, кг', type: 'number', min: 1, max: 500 }, note]
  },
  measurements: {
    title: 'Замеры',
    description: 'Изменения объёмов тела. Заполняй только измеренные значения.',
    fields: [
      date,
      ...['waist', 'chest', 'biceps', 'thigh'].map((key, i) => ({
        key,
        label: ['Талия, см', 'Грудь, см', 'Бицепс, см', 'Бедро, см'][i],
        type: 'number' as const,
        optional: true,
        min: 1,
        max: 400
      })),
      note
    ]
  },
  products: {
    title: 'Продукты',
    description: 'Твой справочник пищевой ценности на 100 г продукта.',
    fields: [{ key: 'name', label: 'Название продукта' }, ...nutrientFields]
  },
  meals: {
    title: 'Питание',
    description: 'Выбери продукт, укажи массу — калории, БЖУ и клетчатка пересчитаются.',
    fields: [
      date,
      { key: 'time', label: 'Время', type: 'time', optional: true },
      { key: 'meal', label: 'Приём пищи', options: ['Завтрак', 'Обед', 'Ужин', 'Перекус'] },
      { key: 'name', label: 'Продукт' },
      { key: 'grams', label: 'Масса, г', type: 'number', min: 0.01, max: 100000 },
      ...nutrientFields,
      note
    ]
  },
  workouts: {
    title: 'Тренировки',
    description: 'Повторения по подходам, отдых и прогресс по каждому упражнению.',
    fields: [
      date,
      { key: 'name', label: 'Упражнение' },
      { key: 'sets', label: 'Подходы через пробел: 10 10 8', type: 'sets' },
      { key: 'rest', label: 'Отдых, сек', type: 'number', optional: true, max: 3600 },
      note
    ]
  }
}
export function isKind(value: string): value is Kind {
  return Object.hasOwn(journals, value)
}
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  const d = new Date(`${value}T00:00:00Z`)
  return (
    year >= 1900 &&
    year <= 2100 &&
    Number.isFinite(d.getTime()) &&
    d.toISOString().slice(0, 10) === value
  )
}
export function validateEntry(kind: Kind, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') throw new Error('Не переданы данные записи.')
  const input = raw as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const field of journals[kind].fields) {
    const value = input[field.key]
    if (value === '' || value === null || value === undefined) {
      if (!field.optional) throw new Error(`Заполни поле «${field.label}».`)
      output[field.key] = field.type === 'number' ? null : ''
      continue
    }
    if (field.type === 'number') {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < (field.min ?? 0) ||
        value > (field.max ?? 1000000)
      )
        throw new Error(`Проверь поле «${field.label}».`)
    } else if (field.type === 'date') {
      if (!validDate(value)) throw new Error(`Проверь дату «${field.label}».`)
    } else if (field.type === 'time') {
      if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
        throw new Error('Некорректное время.')
    } else if (field.type === 'sets') {
      if (
        !Array.isArray(value) ||
        !value.length ||
        value.length > 50 ||
        value.some((n) => !Number.isInteger(n) || n <= 0 || n > 10000)
      )
        throw new Error('Укажи от 1 до 50 подходов положительными целыми числами.')
    } else if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > (field.key === 'note' ? 5000 : 200)
    )
      throw new Error(`Проверь поле «${field.label}».`)
    if (field.options && !field.options.includes(String(value)))
      throw new Error(`Выбери значение «${field.label}».`)
    output[field.key] = typeof value === 'string' ? value.trim() : value
  }
  if (
    kind === 'measurements' &&
    ['waist', 'chest', 'biceps', 'thigh'].every((k) => output[k] === null)
  )
    throw new Error('Укажи хотя бы один замер.')
  return output
}
