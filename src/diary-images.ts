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

function encodeCanvas(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

function hasTransparency(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const pixels = context.getImageData(0, 0, width, height).data
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) return true
  }
  return false
}

async function compressImage(image: HTMLImageElement): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Не удалось обработать изображение.')
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight)
  let targetSide = Math.min(2048, longestSide)
  let format = 'image/webp'
  while (true) {
    const scale = targetSide / longestSide
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.85, 0.7, 0.55]) {
      let blob = await encodeCanvas(canvas, format, quality)
      // Safari can decode WebP without being able to encode it. An unsupported
      // canvas format silently produces PNG, whose quality argument is ignored.
      if (format === 'image/webp' && (!blob || blob.type !== format)) {
        if (blob && DIARY_IMAGE_TYPES.includes(blob.type) && blob.size <= MAX_DIARY_IMAGE_BYTES) return blob
        format = hasTransparency(context, canvas.width, canvas.height) ? 'image/png' : 'image/jpeg'
        blob = await encodeCanvas(canvas, format, quality)
      }
      if (blob && DIARY_IMAGE_TYPES.includes(blob.type) && blob.size <= MAX_DIARY_IMAGE_BYTES) return blob
      if (format === 'image/png') break
    }
    if (targetSide <= 256) break
    targetSide = Math.max(256, Math.floor(targetSide * 0.75))
  }
  throw new Error('Не удалось уменьшить изображение до 1 МБ.')
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
  if (file.size > MAX_DIARY_IMAGE_BYTES || Math.max(image.naturalWidth, image.naturalHeight) > 2048) {
    dataUrl = await readDataUrl(await compressImage(image))
  }
  return { id: crypto.randomUUID(), name: (file.name || 'Из буфера обмена').slice(0, 200), dataUrl }
}
