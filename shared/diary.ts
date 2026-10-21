export type DiaryImage = { id: string; name: string; dataUrl: string }
export const MAX_DIARY_IMAGES = 8
export const MAX_DIARY_IMAGE_BYTES = 1024 * 1024
export const DIARY_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export function diaryFileIsImage(file: DiaryImage): boolean {
  return /^data:image\/(?:jpeg|png|webp|gif);base64,/.test(file.dataUrl)
}

export function validateDiaryImages(raw: unknown): DiaryImage[] {
  if (!Array.isArray(raw) || raw.length > MAX_DIARY_IMAGES)
    throw new Error(`Можно добавить до ${MAX_DIARY_IMAGES} вложений.`)
  const ids = new Set<string>()
  return raw.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Некорректное вложение.')
    const { id, name, dataUrl } = value as DiaryImage
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id) || ids.has(id) ||
        typeof name !== 'string' || !name.trim() || name.length > 200 || typeof dataUrl !== 'string')
      throw new Error('Некорректное вложение.')
    const match = /^data:([a-zA-Z0-9][a-zA-Z0-9!#$&^_.+\/-]*);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
    if (!match || match[2].length % 4 !== 0)
      throw new Error('Некорректный формат файла.')
    ids.add(id)
    return { id, name: name.trim(), dataUrl }
  })
}
