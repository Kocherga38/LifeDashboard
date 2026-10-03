import type { DiaryAudio } from '../shared/diary-audio'
import type { DiaryImage } from '../shared/diary'

type Attachments = { audio?: DiaryAudio[]; images?: DiaryImage[] }
export function diaryAttachmentsSaved(expected: Attachments, saved: Attachments): boolean {
  return (['audio', 'images'] as const).every((key) => {
    const requested = expected[key] ?? []
    const returned = saved[key] ?? []
    return requested.length === returned.length && requested.every((attachment) => returned.some((value) =>
      value.id === attachment.id && value.dataUrl === attachment.dataUrl))
  })
}
