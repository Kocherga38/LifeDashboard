export type DiaryAudio = { id: string; name: string; dataUrl: string }
export const MAX_DIARY_AUDIO = 3
export const MAX_DIARY_AUDIO_BYTES = 5 * 1024 * 1024
export const DIARY_AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav']

export function validateDiaryAudio(raw: unknown): DiaryAudio[] {
  if (!Array.isArray(raw) || raw.length > MAX_DIARY_AUDIO)
    throw new Error(`Можно добавить до ${MAX_DIARY_AUDIO} голосовых.`)
  const ids = new Set<string>()
  return raw.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Некорректное голосовое.')
    const { id, name, dataUrl } = value as DiaryAudio
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id) || ids.has(id) ||
        typeof name !== 'string' || !name.trim() || name.length > 200 || typeof dataUrl !== 'string')
      throw new Error('Некорректное голосовое.')
    const match = /^data:(audio\/(?:webm|ogg|mp4|mpeg|wav|x-wav));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
    if (!match || match[2].length % 4 !== 0 ||
        match[2].length / 4 * 3 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0) > MAX_DIARY_AUDIO_BYTES)
      throw new Error('Выбери аудио WebM, OGG, M4A, MP3 или WAV размером до 5 МБ.')
    ids.add(id)
    return { id, name: name.trim(), dataUrl }
  })
}
