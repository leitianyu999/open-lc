import { Loader2 } from 'lucide-react'
import type { TempFilesCleanupResult, TempFilesCleanupStatus } from '../api'
import { formatDateTime } from '../lib/format'
import { Button, Modal, StatusBadge } from './ui'

type CleanupRun = NonNullable<TempFilesCleanupStatus['running']> | TempFilesCleanupStatus['recentRuns'][number]

const emptyResult: TempFilesCleanupResult = {
  attempted: 0,
  deleted: 0,
  failed: 0,
  skipped: 0,
  orphan: 0,
  waitingForExpiry: 0,
  firstError: null,
}

const runResult = (run?: CleanupRun | null) => run?.result ?? emptyResult

const triggerLabel = (trigger?: string) => (trigger === 'manual' ? '手动' : '自动')

export function CleanupResultSummary({ result }: { result: TempFilesCleanupResult }) {
  const items = [
    ['尝试', result.attempted],
    ['删除', result.deleted],
    ['失败', result.failed],
    ['跳过', result.skipped],
    ['孤儿', result.orphan],
    ['等待过期', result.waitingForExpiry],
  ] as const

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-100" key={label}>
          <div className="text-[11px] font-semibold text-slate-500">{label}</div>
          <div className="mt-1 text-lg font-bold text-slate-900">{value}</div>
        </div>
      ))}
    </div>
  )
}

export function TempFileCleanupProgressModal({
  open,
  pending,
  status,
  result,
  error,
  onClose,
}: {
  open: boolean
  pending: boolean
  status?: TempFilesCleanupStatus
  result?: TempFilesCleanupResult | null
  error?: string | null
  onClose: () => void
}) {
  const running = status?.running ?? null
  const displayResult = running ? runResult(running) : (result ?? runResult(status?.recentRuns[0]))
  const total = running?.totalCandidates ?? status?.recentRuns[0]?.totalCandidates ?? 0
  const processed = running?.processed ?? status?.recentRuns[0]?.processed ?? total
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : pending ? 8 : 100

  return (
    <Modal open={open} title={running ? '正在清理中转文件' : '中转文件清理'} onClose={pending ? () => {} : onClose} maxWidthClassName="max-w-xl">
      <div className="grid gap-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              {running ? <Loader2 className="size-4 animate-spin text-blue-600" /> : null}
              {running ? `${triggerLabel(running.trigger)}清理运行中` : '清理已结束'}
            </div>
            {running ? <StatusBadge status="running" /> : null}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs font-semibold text-slate-500">
            <span>
              已处理 {processed} / {total}
            </span>
            {running?.currentTempFileId ? <span>当前 #{running.currentTempFileId}</span> : null}
          </div>
        </div>
        <CleanupResultSummary result={displayResult} />
        {error || displayResult.firstError ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            {error || displayResult.firstError}
          </div>
        ) : null}
        {status?.recentRuns.length ? (
          <div className="grid gap-2 text-sm">
            <div className="font-bold text-slate-900">最近清理日志</div>
            {status.recentRuns.slice(0, 3).map((run) => (
              <div className="rounded-md border border-slate-200 px-3 py-2" key={run.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-800">
                    #{run.id} · {triggerLabel(run.trigger)}清理
                  </div>
                  <StatusBadge status={run.status} />
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {formatDateTime(run.finishedAt || run.startedAt)} · 尝试 {run.result.attempted} · 删除 {run.result.deleted} · 跳过 {run.result.skipped}
                  {run.result.failed ? ` · 失败 ${run.result.failed}` : ''}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button disabled={pending} onClick={onClose} variant="secondary">
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  )
}
