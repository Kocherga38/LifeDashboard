import test from 'node:test'
import assert from 'node:assert/strict'
import { selectDiaryRecordingType, stopDiaryRecording, verifyRecordedAudio } from '../src/diary-recording.js'

test('recording prefers AAC on Safari and falls back to browser-supported Opus', () => {
  assert.equal(selectDiaryRecordingType(() => true), 'audio/mp4;codecs=mp4a.40.2')
  assert.equal(selectDiaryRecordingType((type) => type === 'audio/mp4'), 'audio/mp4')
  assert.equal(selectDiaryRecordingType((type) => type === 'audio/webm;codecs=opus'), 'audio/webm;codecs=opus')
  assert.equal(selectDiaryRecordingType(() => false), undefined)
})

test('stopping preserves microphone tracks until the encoder delivers final audio; cancelling releases them', () => {
  const events: string[] = []
  const current = {
    cancelled: false,
    recorder: { state: 'recording', stop: () => events.push('flush requested') } as unknown as MediaRecorder,
    stream: { getTracks: () => [{ stop: () => events.push('microphone released') }] } as unknown as MediaStream
  }
  stopDiaryRecording(current)
  assert.deepEqual(events, ['flush requested'])
  assert.equal(current.cancelled, false)
  stopDiaryRecording(current, true)
  assert.deepEqual(events, ['flush requested', 'flush requested', 'microphone released'])
  assert.equal(current.cancelled, true)
  stopDiaryRecording(current)
  assert.equal(current.cancelled, true)
})

test('recorded audio rejects silence and broken files, and accepts microphone signal', async () => {
  const previous = globalThis.OfflineAudioContext
  let samples = new Float32Array([0, 0, 0])
  let corrupt = false
  globalThis.OfflineAudioContext = class {
    async decodeAudioData() {
      if (corrupt) throw new Error('Invalid file')
      return { numberOfChannels: 1, getChannelData: () => samples }
    }
  } as unknown as typeof OfflineAudioContext
  try {
    const blob = new Blob(['audio'])
    await assert.rejects(verifyRecordedAudio(blob), /Микрофон не записал звук/)
    samples = new Float32Array([0, 0.01, -0.01])
    await verifyRecordedAudio(blob)
    corrupt = true
    await assert.rejects(verifyRecordedAudio(blob), /не смог прочитать/)
  } finally {
    if (previous) globalThis.OfflineAudioContext = previous
    else Reflect.deleteProperty(globalThis, 'OfflineAudioContext')
  }
})
