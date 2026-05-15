import { Link, useParams } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { api, messageFromError } from '../api'
import { HistoryDetailContent } from '../components/HistoryDetailContent'
import { Button, EmptyState, Panel } from '../components/ui'
import { downloadableFromHistoryRecord } from '../lib/history'
import { parseDownloaders, sendManyToDownloader, summarizeSendResults, type DownloadableItem, type DownloaderConfig } from '../lib/downloaders'
import { errorAtom, pushNotificationAtom } from '../state'
import { useState } from 'react'

export function HistoryDetailPage() {
  const { recordId } = useParams({ from: '/history/$recordId' })
  const [sending, setSending] = useState(false)
  const setError = useSetAtom(errorAtom)
  const pushNotification = useSetAtom(pushNotificationAtom)
  const settingsQuery = api.api.settings.$get.useQuery()
  const detailQuery = api.api.local.history[':id'].$get.useQuery({
    param: { id: recordId },
  })
  const reparseMutation = api.api.local.history[':id'].reparse.$post.useMutation()
  const detail = detailQuery.data?.data
  const downloaders = parseDownloaders(settingsQuery.data?.data.items.downloadersJson?.value)
  const downloadable = detail?.record ? downloadableFromHistoryRecord(detail.record) : null

  const reparse = async () => {
    if (!detail?.record) return
    setError(null)
    try {
      await reparseMutation.mutateAsync({
        param: { id: String(detail.record.id) },
        json: {},
      })
      await detailQuery.refetch()
    } catch (error) {
      setError(messageFromError(error, '重新解析失败'))
    }
  }

  const sendItems = async (downloader: DownloaderConfig, items: DownloadableItem[]) => {
    if (items.length === 0) return
    setSending(true)
    setError(null)
    try {
      const sent = await sendManyToDownloader(downloader, items)
      pushNotification({
        variant: sent.some((item) => !item.ok) ? 'warning' : 'success',
        message: `${downloader.name}: ${summarizeSendResults(sent)}`,
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/history">
            <Button size="sm" variant="secondary">
              <ArrowLeft className="size-4" />
              返回
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-slate-900">解析详情</h1>
            <div className="mt-1 text-sm text-slate-500">Record {recordId}</div>
          </div>
        </div>
      </div>

      {detailQuery.isPending ? (
        <Panel><div className="text-sm text-slate-500">加载中...</div></Panel>
      ) : !detail ? (
        <Panel><EmptyState title="解析记录不存在" /></Panel>
      ) : (
        <Panel>
          <HistoryDetailContent
            detail={detail}
            downloaders={downloaders}
            downloadable={downloadable}
            onReparse={() => void reparse()}
            onSend={(downloader, items) => void sendItems(downloader, items)}
            reparsePending={reparseMutation.isPending}
            sending={sending}
          />
        </Panel>
      )}
    </div>
  )
}
