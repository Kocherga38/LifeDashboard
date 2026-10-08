import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareDiaryImage } from '../src/diary-images.js'
import { MAX_DIARY_IMAGE_BYTES, validateDiaryImages } from '../shared/diary.js'

type Encoding = { type: string; quality?: number; width: number; height: number }

async function withCanvas(
  encode: (attempt: Encoding) => Blob | null,
  run: () => Promise<void>,
  transparent = false,
) {
  const originals = new Map(['FileReader', 'Image', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  class Reader {
    result = ''
    onload = () => {}
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`
        this.onload()
      })
    }
  }
  class Image {
    naturalWidth = 1920
    naturalHeight = 1080
    decode() { return Promise.resolve() }
  }
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage() {}, getImageData: () => ({ data: [0, 0, 0, transparent ? 0 : 255] }) }),
    toBlob(callback: (blob: Blob | null) => void, type: string, quality?: number) {
      callback(encode({ type, quality, width: this.width, height: this.height }))
    },
  }
  for (const [key, value] of Object.entries({ FileReader: Reader, Image, document: { createElement: () => canvas } })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  try { await run() } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

const largePhoto = () => new File([new Uint8Array(MAX_DIARY_IMAGE_BYTES + 1)], 'photo.png', { type: 'image/png' })
const blob = (type: string, bytes = 100) => new Blob([new Uint8Array(bytes)], { type })

test('Diary photos fall back to JPEG when WebP encoding silently produces oversized PNG', async () => {
  const attempts: Encoding[] = []
  await withCanvas((attempt) => {
    attempts.push(attempt)
    return blob(attempt.type === 'image/webp' ? 'image/png' : attempt.type,
      attempt.type === 'image/webp' ? MAX_DIARY_IMAGE_BYTES + 1 : 100)
  }, async () => {
    const image = await prepareDiaryImage(largePhoto())
    assert.match(image.dataUrl, /^data:image\/jpeg;base64,/)
    assert.deepEqual(validateDiaryImages([image]), [image])
    assert.deepEqual(attempts.map((x) => x.type), ['image/webp', 'image/jpeg'])
    assert.equal(attempts[1].width, 1920)
  })
})

test('Diary compression lowers quality and then resolution until the image fits', async () => {
  const attempts: Encoding[] = []
  await withCanvas((attempt) => {
    attempts.push(attempt)
    return blob(attempt.type, attempt.width > 1440 || attempt.quality! > 0.7 ? MAX_DIARY_IMAGE_BYTES + 1 : 100)
  }, async () => {
    const image = await prepareDiaryImage(largePhoto())
    assert.equal(validateDiaryImages([image]).length, 1)
    assert.deepEqual(attempts.map(({ quality, width }) => [quality, width]),
      [[0.85, 1920], [0.7, 1920], [0.55, 1920], [0.85, 1440], [0.7, 1440]])
  })
})

test('Transparent images retain PNG transparency when WebP is unavailable', async () => {
  const attempts: Encoding[] = []
  await withCanvas((attempt) => {
    attempts.push(attempt)
    return blob('image/png', attempt.width > 1440 ? MAX_DIARY_IMAGE_BYTES + 1 : 100)
  }, async () => {
    const image = await prepareDiaryImage(largePhoto())
    assert.match(image.dataUrl, /^data:image\/png;base64,/)
    assert.equal(validateDiaryImages([image]).length, 1)
    assert.ok(attempts.every((x) => x.type !== 'image/jpeg'))
  }, true)
})

test('Images already within the limit pass through without canvas encoding', async () => {
  await withCanvas(() => { throw new Error('Unexpected compression') }, async () => {
    const file = new File(['small'], 'photo.png', { type: 'image/png' })
    const image = await prepareDiaryImage(file)
    assert.equal(image.dataUrl, 'data:image/png;base64,c21hbGw=')
  })
})

test('Failed encoders stop after bounded compression attempts', async () => {
  let calls = 0
  await withCanvas(() => { calls++; return null }, async () => {
    await assert.rejects(prepareDiaryImage(largePhoto()), /Не удалось уменьшить/)
    assert.ok(calls < 40)
  })
})
