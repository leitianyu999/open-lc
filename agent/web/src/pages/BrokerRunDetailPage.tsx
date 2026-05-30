import { Link, useParams } from '@tanstack/react-router'
import { useSetAtom } from 'jotai'
import { ArrowLeft, FileSearch } from 'lucide-react'
import { useState } from 'react'
import { api, messageFromError, type BrokerRunDetail, type LocalHistoryRecord } from '../api'
import { HistoryDetailDrawer } from '../components/HistoryDetailDrawer'
import { Button, EmptyState, Panel, StatusBadge } from '../components/ui'
import { formatBytes, formatDateTime } from '../lib/format'
import { parseDownloaders, sendManyToDownloader, summarizeSendResults, type DownloadableItem, type DownloaderConfig } from '../lib/downloaders'
import { errorAtom, pushNotificationAtom } from '../state'

export function BrokerRunDetailPage() {
  const { runId } = useParams({ from: '/broker/runs/$runId' })
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null)
  const [sending, setSending] = useState(false)
  const setError = useSetAtom(errorAtom)
  const pushNotification = useSetAtom(pushNotificationAtom)
  const query = api.api.broker.runs[':id'].$get.useQuery({
    param: { id: runId },
    refetchInterval: 5000,
  })
  const settingsQuery = api.api.settings.$get.useQuery()
  const reparseMutation = api.api.local.history[':id'].reparse.$post.useMutation()
  const detailQuery = api.api.local.history[':id'].$get.useQuery({
    param: { id: String(selectedRecordId ?? '') },
    enabled: selectedRecordId !== null,
  })
  const detail = query.data?.data
  const downloaders = parseDownloaders(settingsQuery.data?.data.items.downloadersJson?.value)

  const reparse = async (record: LocalHistoryRecord) => {
    setError(null)
    try {
      await reparseMutation.mutateAsync({
        param: { id: String(record.id) },
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
          <Link to="/broker">
            <Button size="sm" variant="secondary">
              <ArrowLeft className="size-4" />
              返回
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-slate-900">Broker 执行详情</h1>
            <div className="mt-1 text-sm text-slate-500">Run {runId}</div>
          </div>
        </div>
      </div>

      {query.isPending ? (
        <Panel>
          <div className="text-sm text-slate-500">加载中...</div>
        </Panel>
      ) : !detail ? (
        <Panel>
          <EmptyState title="Broker run 不存在" />
        </Panel>
      ) : (
        <>
          <Panel className="grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold text-slate-900">{detail.payloadSummary?.fileName || `Task ${detail.taskId}`}</h2>
                <div className="mt-1 text-sm text-slate-500">Task {detail.taskId}</div>
              </div>
              <StatusBadge status={detail.status} />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm">
              <InfoCard label="Participation" value={detail.participationId || '-'} />
              <InfoCard label="失败码" value={detail.failureCode || '-'} />
              <InfoCard label="开始" value={formatDateTime(detail.startedAt || detail.createdAt)} />
              <InfoCard label="更新" value={formatDateTime(detail.updatedAt)} />
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">消息</div>
              <div className="mt-2 text-sm text-slate-700">{detail.message || '-'}</div>
            </div>
            {detail.payloadSummary ? (
              <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm md:grid-cols-2">
                <InfoRow label="Provider" value={detail.payloadSummary.provider} />
                <InfoRow label="File ID" value={detail.payloadSummary.fileId} />
                <InfoRow label="文件" value={detail.payloadSummary.fileName} />
                <InfoRow label="大小" value={formatBytes(detail.payloadSummary.fileSizeBytes)} />
              </div>
            ) : null}
            {detail.localParseRecordId ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setSelectedRecordId(detail.localParseRecordId ?? null)} size="sm" variant="secondary">
                  <FileSearch className="size-4" />
                  查看本地解析历史 #{detail.localParseRecordId}
                </Button>
              </div>
            ) : null}
          </Panel>

          <Panel className="grid gap-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">事件日志</h2>
              <span className="text-xs font-semibold text-slate-500">{detail.events.length} 条</span>
            </div>
            <BrokerEventTimeline events={detail.events} />
          </Panel>
        </>
      )}
      <HistoryDetailDrawer
        detail={detailQuery.data?.data}
        downloaders={downloaders}
        loading={detailQuery.isFetching}
        open={selectedRecordId !== null}
        onClose={() => setSelectedRecordId(null)}
        onNotify={pushNotification}
        onReparse={reparse}
        onSend={(downloader, items) => void sendItems(downloader, items)}
        reparsePending={reparseMutation.isPending}
        sending={sending}
      />
    </div>
  )
}

function BrokerEventTimeline({ events }: { events: BrokerRunDetail['events'] }) {
  if (events.length === 0) return <EmptyState title="暂无事件日志" />

  return (
    <div className="grid gap-3">
      {events.map((event) => (
        <div className="grid grid-cols-[16px_minmax(0,1fr)] gap-3" key={event.id}>
          <div className="relative flex justify-center">
            <span
              className={`mt-1.5 size-2.5 rounded-full ${event.status === 'success' ? 'bg-emerald-500' : event.status === 'failed' ? 'bg-red-500' : event.status === 'warning' ? 'bg-amber-500' : 'bg-blue-500'}`}
            />
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{event.type}</span>
                <StatusBadge status={event.status} />
                {event.code ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{event.code}</span> : null}
              </div>
              <span className="text-xs text-slate-500">{formatDateTime(event.createdAt)}</span>
            </div>
            <div className="mt-2 text-sm text-slate-700">{event.message}</div>
            {event.details ? (
              <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-slate-950 px-3 py-2 text-xs leading-5 text-slate-100">
                {formatDetails(event.details)}
              </pre>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="min-w-0 break-words font-semibold text-slate-800">{value}</span>
    </div>
  )
}

const formatDetails = (value: unknown) => {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}
