import { useEffect, useRef, useState } from 'react'
import { selectDiaryRecordingType, stopDiaryRecording, verifyRecordedAudio } from './diary-recording'
import type { RecordingSession } from './diary-recording'
import { DIARY_AUDIO_TYPES, MAX_DIARY_AUDIO_BYTES } from '../shared/diary-audio'
import type { DiaryAudio } from '../shared/diary-audio'

export async function prepareDiaryAudio(blob: Blob, name: string): Promise<DiaryAudio> {
  const type = blob.type.split(';')[0]
  if (!DIARY_AUDIO_TYPES.includes(type)) throw new Error('Выбери аудио WebM, OGG, M4A, MP3 или WAV.')
  if (!blob.size || blob.size > MAX_DIARY_AUDIO_BYTES) throw new Error('Голосовое должно быть непустым и не больше 5 МБ.')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Не удалось прочитать голосовое.'))
    reader.readAsDataURL(new Blob([blob], { type }))
  })
  return { id: crypto.randomUUID(), name: name.slice(0, 200), dataUrl }
}

export function useDiaryRecorder(onReady: (audio: DiaryAudio) => void, onError: (message: string) => void) {
  const [active, setActive] = useState(false)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const session = useRef<RecordingSession | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const current = session.current
      if (!current) return
      current.cancelled = true
      clearInterval(current.timer)
      if (current.recorder?.state === 'recording') current.recorder.stop()
      current.stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])
  const stop = (cancel = false) => {
    const current = session.current
    if (!current) return
    stopDiaryRecording(current, cancel)
    setRecording(false)
  }
  const start = async () => {
    if (session.current) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError('Запись с микрофона недоступна. Открой Trellis через localhost или HTTPS либо загрузи аудиофайл.'); return
    }
    const current: RecordingSession = { cancelled: false }
    session.current = current
    setActive(true); setSeconds(0)
    const finish = () => {
      clearInterval(current.timer)
      current.stream?.getTracks().forEach((track) => track.stop())
      if (session.current === current) session.current = null
      if (mounted.current) { setActive(false); setRecording(false) }
    }
    try {
      current.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mounted.current || current.cancelled) { finish(); return }
      const mimeType = selectDiaryRecordingType((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(current.stream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 })
      current.recorder = recorder
      const chunks: Blob[] = []
      let bytes = 0
      recorder.ondataavailable = (event) => {
        if (event.data.size) { chunks.push(event.data); bytes += event.data.size }
        if (bytes > MAX_DIARY_AUDIO_BYTES) {
          current.cancelled = true
          if (mounted.current) onError('Голосовое превысило 5 МБ. Запиши более короткое сообщение.')
          stop(true)
        }
      }
      recorder.onerror = () => {
        current.cancelled = true
        if (mounted.current) onError('Не удалось записать голосовое. Проверь микрофон и повтори.')
        stop(true); finish()
      }
      recorder.onstop = async () => {
        current.stream?.getTracks().forEach((track) => track.stop())
        clearInterval(current.timer)
        try {
          if (!current.cancelled && mounted.current) {
            const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type })
            await verifyRecordedAudio(blob)
            const voice = await prepareDiaryAudio(blob, `Голосовое ${new Date().toLocaleString('ru-RU')}`)
            if (!current.cancelled && mounted.current) onReady(voice)
          }
        } catch (error) { if (mounted.current) onError((error as Error).message) }
        finally { finish() }
      }
      recorder.start()
      setRecording(true)
      const started = Date.now()
      current.timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000)
        setSeconds(elapsed)
        if (elapsed >= 600) stop()
      }, 1000)
    } catch (error) {
      if (mounted.current) onError((error as Error).name === 'NotAllowedError' ? 'Разреши доступ к микрофону в браузере, чтобы записать голосовое.' : 'Не удалось открыть микрофон. Проверь подключение и разрешения.')
      finish()
    }
  }
  return { active, recording, seconds, start, stop }
}
