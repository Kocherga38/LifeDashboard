export type DiaryImage = { id: string; name: string; dataUrl: string }
export const MAX_DIARY_IMAGES = 8
export const MAX_DIARY_IMAGE_BYTES = 1024 * 1024
export const DIARY_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export function validateDiaryImages(raw: unknown): DiaryImage[] {
  if (!Array.isArray(raw) || raw.length > MAX_DIARY_IMAGES)
    throw new Error(`Можно добавить до ${MAX_DIARY_IMAGES} изображений.`)
  const ids = new Set<string>()
  return raw.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Некорректное изображение.')
    const { id, name, dataUrl } = value as DiaryImage
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id) || ids.has(id) ||
        typeof name !== 'string' || !name.trim() || name.length > 200 || typeof dataUrl !== 'string')
      throw new Error('Некорректное изображение.')
    const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
    if (!match || match[2].length % 4 !== 0 ||
        match[2].length / 4 * 3 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0) > MAX_DIARY_IMAGE_BYTES)
      throw new Error('Изображение должно быть PNG, JPEG, WebP или GIF и не больше 1 МБ.')
    ids.add(id)
    return { id, name: name.trim(), dataUrl }
  })
}
