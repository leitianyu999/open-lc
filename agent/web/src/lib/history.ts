import type { LocalHistoryRecord } from '../api'
import type { DownloadableItem } from './downloaders'

export const downloadableFromHistoryRecord = (record: LocalHistoryRecord): DownloadableItem | null => {
  if (!record.resultUrl) return null
  return {
    id: String(record.id),
    filename: record.filename,
    url: record.resultUrl,
    sourceDir: record.dir,
    ua: record.resultUa,
  }
}
