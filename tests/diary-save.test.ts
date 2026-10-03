import test from 'node:test'
import assert from 'node:assert/strict'
import { diaryAttachmentsSaved } from '../src/diary-save.js'

const voice = { id: 'voice', name: 'Голосовое', dataUrl: 'data:audio/mp4;base64,AAAA' }
test('saving detects old servers that silently drop audio and refuses mismatched attachments', () => {
  assert.equal(diaryAttachmentsSaved({ audio: [voice] }, {}), false)
  assert.equal(diaryAttachmentsSaved({ audio: [voice] }, { audio: [] }), false)
  assert.equal(diaryAttachmentsSaved({ audio: [voice] }, { audio: [{ ...voice, dataUrl: 'data:audio/mp4;base64,AQAA' }] }), false)
  assert.equal(diaryAttachmentsSaved({ audio: [voice] }, { audio: [voice] }), true)
  assert.equal(diaryAttachmentsSaved({}, {}), true)
  assert.equal(diaryAttachmentsSaved({ audio: [] }, { audio: [voice] }), false)
  const image = { id: 'image', name: 'Фото', dataUrl: 'data:image/png;base64,AAAA' }
  assert.equal(diaryAttachmentsSaved({ audio: [voice], images: [image] }, { audio: [voice] }), false)
  assert.equal(diaryAttachmentsSaved({ audio: [voice], images: [image] }, { audio: [voice], images: [image] }), true)
})
