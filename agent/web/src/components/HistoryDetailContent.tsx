import { Clipboard, Copy, RotateCcw } from 'lucide-react'
import { DownloaderSendButton } from './DownloaderSendButton'
import { Button, EmptyState, MiddleEllipsis, StatusBadge } from './ui'
import { formatBytes, formatDateTime } from '../lib/format'
import type { LocalHistoryDetail, LocalHistoryRecord } from '../api'
import type { DownloadableItem, DownloaderConfig } from '../lib/downloaders'

const formatDetails = (value: unknown) => {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

const copyText = async (value: string) => {
  await navigator.clipboard.writeText(value)
}

export function HistoryDetailContent({
  detail,
  downloaders,
  downloadable,
  reparsePending,
  sending,
  onReparse,
  onSend,
}: {
  detail?: LocalHistoryDetail
  downloaders: DownloaderConfig[]
  downloadable: DownloadableItem | null
  reparsePending: boolean
  sending: boolean
  onReparse: (record: LocalHistoryRecord) => void
  onSend: (downloader: DownloaderConfig, items: DownloadableItem[]) => void
}) {
  const record = detail?.record
  if (!detail || !record) return <EmptyState title="没有详情数据" />

  return (
    <div className="grid gap-5">
      <RecordSummary record={record} />
      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-bold text-slate-900">状态机记录</h4>
          <span className="text-xs font-semibold text-slate-500">{detail.events.length} 条</span>
        </div>
        <EventTimeline events={detail.events} />
      </section>
      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-bold text-slate-900">账号尝试</h4>
          <span className="text-xs font-semibold text-slate-500">{detail.attempts.length} 次</span>
        </div>
        <AttemptList attempts={detail.attempts} />
      </section>
      <section className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
        {record.resultUrl ? (
          <>
            <Button onClick={() => copyText(record.resultUrl ?? '')} size="sm" variant="secondary">
              <Copy className="size-4" />
              复制链接
            </Button>
            {downloadable ? <DownloaderSendButton downloaders={downloaders} items={[downloadable]} menu={false} pending={sending} onSend={onSend} /> : null}
          </>
        ) : null}
        {record.resultUa ? (
          <Button onClick={() => copyText(record.resultUa ?? '')} size="sm" variant="secondary">
            <Clipboard className="size-4" />
            复制 UA
          </Button>
        ) : null}
        <Button disabled={reparsePending} onClick={() => onReparse(record)} size="sm" variant="ghost">
          <RotateCcw className="size-4" />
          重新解析
        </Button>
      </section>
    </div>
  )
}

function RecordSummary({ record }: { record: LocalHistoryRecord }) {
  return (
    <section className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge status={record.status} />
        <span className="text-xs font-semibold text-slate-500">#{record.id}</span>
      </div>
      <div className="grid gap-2 text-sm">
        <InfoRow label="文件" value={record.filename} />
        <InfoRow label="大小" value={`${formatBytes(record.sizeBytes)} · fs_id ${record.fsId}`} />
        <InfoRow label="路线" value={record.routeLabel} />
        <InfoRow label="账号" value={record.accountId ? String(record.accountId) : '-'} />
        <InfoRow label="结果" value={record.resultUrl ? (record.linkExpired ? '可能已过期' : '可用结果') : '-'} />
        <InfoRow label="创建" value={formatDateTime(record.createdAt)} />
        {record.errorCode || record.errorMessage ? (
          <InfoRow label="错误" value={[record.errorCode, record.errorMessage].filter(Boolean).join(' · ')} tone="danger" />
        ) : null}
      </div>
    </section>
  )
}

function EventTimeline({ events }: { events: LocalHistoryDetail['events'] }) {
  if (events.length === 0) return <EmptyState title="暂无状态机记录" />

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
              <pre className="mt-2 max-h-36 overflow-auto rounded-md bg-slate-950 px-3 py-2 text-xs leading-5 text-slate-100">
                {formatDetails(event.details)}
              </pre>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function AttemptList({ attempts }: { attempts: LocalHistoryDetail['attempts'] }) {
  if (attempts.length === 0) return <EmptyState title="暂无账号尝试" />

  return (
    <div className="grid gap-2">
      {attempts.map((attempt) => (
        <div className="rounded-lg border border-slate-200 p-3" key={attempt.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={attempt.status} />
              <span className="text-sm font-semibold text-slate-900">账号 {attempt.accountId ?? '-'}</span>
              {attempt.errorCode ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{attempt.errorCode}</span>
              ) : null}
            </div>
            <span className="text-xs text-slate-500">{formatDateTime(attempt.createdAt)}</span>
          </div>
          {attempt.message ? <div className="mt-2 text-sm text-slate-600">{attempt.message}</div> : null}
        </div>
      ))}
    </div>
  )
}

function InfoRow({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'danger' }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={`min-w-0 break-words font-semibold ${tone === 'danger' ? 'text-red-700' : 'text-slate-800'}`}>{value}</span>
    </div>
  )
}
