export type RecordingSession = { recorder?: MediaRecorder; stream?: MediaStream; timer?: ReturnType<typeof setInterval>; cancelled: boolean }

export function selectDiaryRecordingType(supported: (type: string) => boolean): string | undefined {
  // Prefer AAC/MP4 on Safari; fall back to Opus on browsers that cannot record it.
  return ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus'].find(supported)
}

export function stopDiaryRecording(current: RecordingSession, cancel = false) {
  current.cancelled = current.cancelled || cancel
  clearInterval(current.timer)
  if (current.recorder?.state === 'recording') current.recorder.stop()
  // stop() queues the encoder flush. Keep capture alive until onstop has received
  // the final dataavailable event; stopping tracks here can lose audio on Safari.
  if (cancel) current.stream?.getTracks().forEach((track) => track.stop())
}

export async function verifyRecordedAudio(blob: Blob): Promise<void> {
  const decoder = new OfflineAudioContext(1, 1, 44100)
  let audio: AudioBuffer
  try { audio = await decoder.decodeAudioData(await blob.arrayBuffer()) }
  catch { throw new Error('Браузер не смог прочитать записанное аудио. Повтори запись или загрузи аудиофайл.') }
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    if (audio.getChannelData(channel).some((sample) => Math.abs(sample) > 0.00001)) return
  }
  throw new Error('Микрофон не записал звук. Проверь выбранный микрофон и уровень входа в настройках macOS и разрешение браузера, затем повтори запись.')
}
