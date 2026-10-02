import { DIARY_IMAGE_TYPES, MAX_DIARY_IMAGE_BYTES } from '../shared/diary'
import type { DiaryImage } from '../shared/diary'

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение.'))
    reader.readAsDataURL(blob)
  })
}

export async function prepareDiaryImage(file: File): Promise<DiaryImage> {
  if (!DIARY_IMAGE_TYPES.includes(file.type))
    throw new Error('Выбери PNG, JPEG, WebP или GIF.')
  if (file.size > 30 * 1024 * 1024) throw new Error('Исходное изображение слишком большое: максимум 30 МБ.')
  const source = await readDataUrl(file)
  const image = new Image()
  image.src = source
  await image.decode().catch(() => { throw new Error('Не удалось открыть изображение.') })
  let dataUrl = source
  if (file.size > MAX_DIARY_IMAGE_BYTES || Math.max(image.width, image.height) > 2048) {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 2048 / Math.max(image.width, image.height))
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Не удалось обработать изображение.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
    if (!blob || blob.size > MAX_DIARY_IMAGE_BYTES) throw new Error('Изображение слишком большое даже после уменьшения. Выбери меньший файл.')
    dataUrl = await readDataUrl(blob)
  }
  return { id: crypto.randomUUID(), name: (file.name || 'Из буфера обмена').slice(0, 200), dataUrl }
}
