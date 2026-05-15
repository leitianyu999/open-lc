import { useState, type ChangeEvent, type ReactNode } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  File,
  Folder,
  Loader2,
  RefreshCw,
  Square,
  HardDrive,
  Link2,
  ListChecks,
  X,
} from 'lucide-react'
import { api, honoClient, messageFromError, type LocalAccount, type ParseJob, type ShareFile } from '../api'
import {
  diskFilesAtom,
  errorAtom,
  executionOpenAtom,
  executionTabAtom,
  parseQueueAtom,
  parseResultsAtom,
  pushNotificationAtom,
  selectedFilesAtom,
  shareDirectoryCookieAtom,
  workspaceContextAtom,
  workspaceNodesAtom,
  type ParseResult,
  type QueuedFile,
  type SelectedFile,
  type WorkspaceDirectoryNode,
} from '../state'
import { formatBytes, formatDateTime, joinPath, parsePwd, pathParts } from '../lib/format'
import { parseDownloaders, sendManyToDownloader, serializeDownloaders, summarizeSendResults, type DownloadableItem, type DownloaderConfig } from '../lib/downloaders'
import { usePagination } from '../lib/usePagination'
import { Button, EmptyState, Field, HoverTooltip, Input, MiddleEllipsis, Modal, Pagination, Panel, Select, StateIcon, Textarea } from './ui'
import { DownloaderSendButton } from './DownloaderSendButton'

const PAGE_SIZE = 50

type DirectoryNode = WorkspaceDirectoryNode

type MergedDirectoryView = {
  label: string
  dir: string
  node?: DirectoryNode
}

type LoadDirectoryOptions = {
  append?: boolean
  expand?: boolean
  resetWorkspace?: boolean
  activate?: boolean
}

type PendingShareDirectoryLoad = {
  dir: string
  options?: LoadDirectoryOptions
}

const copyText = async (value: string) => {
  await navigator.clipboard.writeText(value)
}

const resultDownloadableId = (result: ParseResult, index: number) =>
  String(result.job?.id ?? result.data?.record_id ?? result.fsId ?? index)

const downloadableFromResult = (result: ParseResult, index: number): DownloadableItem | null => {
  const url = result.data?.urls[0]
  if (result.status !== 'success' || !url) return null
  return {
    id: resultDownloadableId(result, index),
    filename: result.filename,
    url,
    ua: result.data?.ua,
  }
}

function ModeSegmentedControl({
  value,
  onChange,
}: {
  value: 'share' | 'disk'
  onChange: (value: 'share' | 'disk') => void
}) {
  const items = [
    { value: 'share' as const, label: '分享浏览', icon: Link2 },
    { value: 'disk' as const, label: '网盘浏览', icon: HardDrive },
  ]

  return (
    <div className="flex rounded-lg bg-slate-100 p-1">
      {items.map((item) => {
        const Icon = item.icon
        const active = value === item.value
        return (
          <button
            className={`flex min-h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition ${active ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            key={item.value}
            onClick={() => onChange(item.value)}
            type="button"
          >
            <Icon className="size-4" />
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

const emptyNode = (dir: string): DirectoryNode => ({
  dir,
  files: [],
  page: 0,
  hasMore: false,
  loading: false,
  error: null,
  expanded: false,
  loaded: false,
})

const fileDir = (file: ShareFile, fallbackDir: string) => {
  if (!file.path) return fallbackDir
  const index = file.path.lastIndexOf('/')
  return index <= 0 ? '/' : file.path.slice(0, index)
}

const selectedFromFile = (file: ShareFile, dir: string, accountId?: number): SelectedFile => ({
  fsId: file.fs_id,
  filename: file.server_filename,
  size: file.size,
  dir: fileDir(file, dir),
  path: file.path,
  accountId,
})

const hasSelectedFsId = (selected: Map<number, SelectedFile>, fsId: number) => selected.has(fsId)

const directoryPathFor = (file: ShareFile, parentDir: string) =>
  file.path || joinPath(parentDir, file.server_filename)

const treeIndentPx = (depth: number) => depth * 22

const directoryFiles = (node?: DirectoryNode) =>
  (node?.files ?? []).filter((item) => !item.is_dir)

const resolveMergedDirectory = (file: ShareFile, parentDir: string, nodes: Record<string, DirectoryNode>): MergedDirectoryView => {
  let label = file.server_filename
  let dir = directoryPathFor(file, parentDir)
  let node = nodes[dir]

  while (
    node?.loaded &&
    !node.loading &&
    !node.error &&
    !node.hasMore &&
    node.files.length === 1 &&
    node.files[0]?.is_dir
  ) {
    const onlyDir = node.files[0]
    label = `${label}/${onlyDir.server_filename}`
    dir = directoryPathFor(onlyDir, dir)
    node = nodes[dir]
  }

  return { label, dir, node }
}

const collapseBreadcrumbs = (dir: string, nodes: Record<string, DirectoryNode>) => {
  const parts = pathParts(dir)
  if (parts.length <= 2) return parts

  const merged = [parts[0]]
  for (let index = 1; index < parts.length; index += 1) {
    const current = parts[index]
    const parent = parts[index - 1]
    const parentNode = nodes[parent.path]
    const singleChild = parentNode?.loaded && parentNode.files.length === 1 && parentNode.files[0]?.is_dir
      ? directoryPathFor(parentNode.files[0], parent.path)
      : null
    const previous = merged[merged.length - 1]

    if (previous.path !== '/' && singleChild === current.path) {
      merged[merged.length - 1] = {
        label: `${previous.label}/${current.label}`,
        path: current.path,
      }
      continue
    }

    merged.push(current)
  }

  return merged
}

export function ParserWorkspace() {
  const accountsQuery = api.api.local.accounts.$get.useQuery()
  const settingsQuery = api.api.settings.$get.useQuery()
  const settingsMutation = api.api.settings.$put.useMutation()
  const [context, setContext] = useAtom(workspaceContextAtom)
  const [selected, setSelected] = useAtom(selectedFilesAtom)
  const [queue, setQueue] = useAtom(parseQueueAtom)
  const [results, setResults] = useAtom(parseResultsAtom)
  const [, setDiskFiles] = useAtom(diskFilesAtom)
  const [nodes, setNodes] = useAtom(workspaceNodesAtom)
  const [shareCookie, setShareCookie] = useAtom(shareDirectoryCookieAtom)
  const [cookieModalOpen, setCookieModalOpen] = useState(false)
  const [cookieDraft, setCookieDraft] = useState(shareCookie)
  const [cookieDraftError, setCookieDraftError] = useState<string | null>(null)
  const [pendingShareDirectoryLoad, setPendingShareDirectoryLoad] = useState<PendingShareDirectoryLoad | null>(null)
  const [executionOpen, setExecutionOpen] = useAtom(executionOpenAtom)
  const setError = useSetAtom(errorAtom)
  const pushNotification = useSetAtom(pushNotificationAtom)
  const shareFilesMutation = api.api.local.browser.share.$post.useMutation()
  const shareCookieTemplateQuery = api.api.local.browser['share-cookie-template'].$get.useQuery()
  const submitJobMutation = api.api.local.parse.jobs.$post.useMutation()
  const diskResolveMutation = api.api.local.browser.disk.resolve.$post.useMutation()
  const currentNode = nodes[context.dir]
  const localAccounts = accountsQuery.data?.data ?? []
  const activeLocalAccounts = localAccounts.filter((item) => item.status === 'active')
  const executionCount = queue.length + results.length
  const downloaders = parseDownloaders(settingsQuery.data?.data.items.downloadersJson?.value)
  const fakeCookieTemplate = shareCookieTemplateQuery.data?.data.fakeCookie ?? ''
  const setDefaultDownloader = async (downloaderId: string) => {
    const next = downloaders.map((item) => ({ ...item, isDefault: item.id === downloaderId }))
    try {
      await settingsMutation.mutateAsync({
        json: {
          values: {
            downloadersJson: serializeDownloaders(next),
          },
        },
      })
      await settingsQuery.refetch()
      // pushNotification({
      //   variant: 'success',
      //   message: '默认下载器已切换',
      // })
    } catch (error) {
      setError(messageFromError(error, '切换默认下载器失败'))
    }
  }

  const setNode = (dir: string, updater: (node: DirectoryNode) => DirectoryNode) => {
    setNodes((prev) => ({
      ...prev,
      [dir]: updater(prev[dir] ?? emptyNode(dir)),
    }))
  }

  const loadDiskDirectory = async (dir: string, options?: LoadDirectoryOptions) => {
    if (context.accountId <= 0) {
      setError('请先选择一个账号')
      return
    }
    const append = options?.append === true
    const previous = nodes[dir]
    const page = append ? (previous?.page ?? 0) + 1 : 1
    setError(null)
    setNode(dir, (node) => ({
      ...node,
      loading: true,
      error: null,
      expanded: options?.expand ?? node.expanded,
    }))
    try {
      const response = await honoClient.api.local.browser.disk[':id'].$get({
        param: { id: String(context.accountId) },
        query: {
          dir,
          page: String(page),
          pageSize: String(PAGE_SIZE),
          order: 'filename',
        },
      })
      if (!response.ok) throw new Error('网盘目录读取失败')
      const json = await response.json()
      const list = json.data.list ?? []
      let nextFiles: ShareFile[] = []
      setNode(dir, (node) => {
        nextFiles = append ? [...node.files, ...list] : list
        return {
          ...node,
          files: nextFiles,
          page,
          hasMore: list.length === PAGE_SIZE,
          loading: false,
          error: null,
          expanded: options?.expand ?? node.expanded,
          loaded: true,
        }
      })
      setDiskFiles(nextFiles)
      if (options?.activate !== false) {
        setContext((prev) => ({
          ...prev,
          dir,
          paths: pathParts(dir).map((item) => item.path),
        }))
      }
      if (options?.resetWorkspace) {
        setSelected(new Map())
      }
    } catch (error) {
      const message = messageFromError(error, '获取网盘文件列表失败')
      setNode(dir, (node) => ({
        ...node,
        loading: false,
        error: message,
      }))
      setError(message)
    }
  }

  const openCookieModal = (dir: string, options?: LoadDirectoryOptions) => {
    setCookieDraft(shareCookie)
    setCookieDraftError(null)
    setPendingShareDirectoryLoad({ dir, options })
    setCookieModalOpen(true)
  }

  const loadShareDirectoryWithCookie = async (dir: string, options: LoadDirectoryOptions | undefined, cookie: string) => {
    const shareUrl = context.shareUrl.trim()
    if (!shareUrl) {
      setError('请先输入百度网盘分享链接')
      return
    }

    const normalizedCookie = cookie.trim()
    if (!normalizedCookie) {
      openCookieModal(dir, options)
      return
    }

    const append = options?.append === true
    const previous = nodes[dir]
    const page = append ? (previous?.page ?? 0) + 1 : 1
    const pwd = context.pwd.trim()
    setError(null)
    if (options?.resetWorkspace) {
      setNodes({})
      setDiskFiles([])
    }
    setNode(dir, (node) => ({
      ...node,
      loading: true,
      error: null,
      expanded: options?.expand ?? node.expanded,
    }))

    try {
      const response = await shareFilesMutation.mutateAsync({
        json: {
          shareUrl,
          cookie: normalizedCookie,
          pwd,
          dir,
          page,
          num: PAGE_SIZE,
          order: 'filename',
        },
      })
      const list = response.data.list ?? []
      setNode(dir, (node) => ({
        ...node,
        files: append ? [...node.files, ...list] : list,
        page,
        hasMore: list.length === PAGE_SIZE,
        loading: false,
        error: null,
        expanded: options?.expand ?? node.expanded,
        loaded: true,
      }))
      if (options?.activate !== false) {
        setContext((prev) => ({
          ...prev,
          dir,
          paths: pathParts(dir).map((item) => item.path),
        }))
      }
      if (options?.resetWorkspace) {
        setSelected(new Map())
      }
    } catch (error) {
      const message = messageFromError(error, '获取文件列表失败')
      setNode(dir, (node) => ({
        ...node,
        loading: false,
        error: message,
      }))
      setError(message)
    }
  }

  const loadShareDirectory = async (dir: string, options?: LoadDirectoryOptions) => {
    const shareUrl = context.shareUrl.trim()
    if (!shareUrl) {
      setError('请先输入百度网盘分享链接')
      return
    }

    const normalizedCookie = shareCookie.trim()
    if (!normalizedCookie) {
      setError(null)
      openCookieModal(dir, options)
      return
    }

    await loadShareDirectoryWithCookie(dir, options, normalizedCookie)
  }

  const closeCookieModal = () => {
    setCookieModalOpen(false)
    setPendingShareDirectoryLoad(null)
    setCookieDraftError(null)
  }

  const saveCookieAndContinue = async () => {
    const normalizedCookie = cookieDraft.trim()
    if (!normalizedCookie) {
      setCookieDraftError('请填写用于读取分享目录的 Cookie')
      return
    }

    const pendingLoad = pendingShareDirectoryLoad
    setShareCookie(normalizedCookie)
    setCookieModalOpen(false)
    setPendingShareDirectoryLoad(null)
    setCookieDraftError(null)

    if (pendingLoad) {
      await loadShareDirectoryWithCookie(pendingLoad.dir, pendingLoad.options, normalizedCookie)
    }
  }

  const loadDirectory = async (dir: string, options?: LoadDirectoryOptions) => {
    if (context.mode === 'disk') {
      await loadDiskDirectory(dir, options)
      return
    }
    await loadShareDirectory(dir, options)
  }

  const refreshRoot = async () => {
    if (context.mode === 'disk') {
      setNodes({})
      setDiskFiles([])
    }
    await loadDirectory('/', { resetWorkspace: true })
  }

  const enterDirectory = async (file: ShareFile, parentDir: string) => {
    if (!file.is_dir) return
    const nextDir = file.path || joinPath(parentDir, file.server_filename)
    await loadDirectory(nextDir)
  }

  const toggleDirectory = async (file: ShareFile, parentDir: string) => {
    if (!file.is_dir) return
    const dir = file.path || joinPath(parentDir, file.server_filename)
    const node = nodes[dir]
    if (node?.expanded) return
    setNode(dir, (current) => ({ ...current, expanded: true }))
    if (!node?.loaded) await loadDirectory(dir, { expand: true, activate: false })
  }

  const loadMore = async (dir: string) => {
    if (context.mode === 'disk') {
      await loadDiskDirectory(dir, { append: true, expand: nodes[dir]?.expanded, activate: false })
      return
    }
    await loadShareDirectory(dir, { append: true, expand: nodes[dir]?.expanded, activate: false })
  }

  const retryDirectory = async (dir: string) => {
    await loadDirectory(dir, { expand: true, activate: false })
  }

  const toggleFile = (file: ShareFile, dir: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (checked) next.set(file.fs_id, selectedFromFile(file, dir, context.mode === 'disk' ? context.accountId : undefined))
      else next.delete(file.fs_id)
      return next
    })
  }

  const toggleDirectorySelection = (dir: string, checked: boolean) => {
    const files = (nodes[dir]?.files ?? []).filter((item) => !item.is_dir)
    setSelected((prev) => {
      const next = new Map(prev)
      for (const file of files) {
        if (checked) next.set(file.fs_id, selectedFromFile(file, dir, context.mode === 'disk' ? context.accountId : undefined))
        else next.delete(file.fs_id)
      }
      return next
    })
  }

  const buildQueue = () => {
    const next = Array.from(selected.values()).map((file) => ({
      fsId: file.fsId,
      filename: file.filename,
      size: file.size,
      dir: file.dir,
      accountId: file.accountId,
      status: 'waiting' as const,
    }))
    setQueue(next)
    return next
  }

  const statusFromJob = (job: ParseJob): QueuedFile['status'] =>
    job.status === 'running'
      ? 'running'
      : job.status === 'success'
        ? 'success'
        : job.status === 'failed'
          ? 'failed'
          : 'queued'

  const messageFromJob = (job: ParseJob) => {
    if (job.status === 'queued') return `排队中，前面还有 ${job.ahead_count} 个任务`
    if (job.status === 'running') return '解析中'
    if (job.status === 'success') return '解析成功'
    return job.errorMessage ?? job.errorCode ?? '解析失败'
  }

  const pollJob = async (job: ParseJob, onUpdate: (next: ParseJob) => void) => {
    let current = job
    while (current.status === 'queued' || current.status === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const response = await honoClient.api.local.parse.jobs[':id'].$get({
        param: { id: String(job.id) },
      })
      if (!response.ok) throw new Error('任务状态查询失败')
      const polled = await response.json()
      current = polled.data
      onUpdate(current)
    }
    return current
  }

  const appendResult = async (item: Pick<QueuedFile, 'fsId' | 'filename'>, current: ParseJob, prepend = false) => {
    const addResult = (result: ParseResult) => {
      setResults((prev) => prepend ? [result, ...prev] : [...prev, result])
    }

    if (current.status === 'success' && current.result) {
      const result: ParseResult = {
        fsId: item.fsId,
        filename: item.filename,
        status: 'success',
        message: '解析成功',
        data: {
          ...current.result,
          link_expires_at: current.result.link_expires_at ?? null,
        },
        job: current,
      }
      addResult(result)
      await api.api.local.history.$get.invalidate()
      return
    }

    addResult({
      fsId: item.fsId,
      filename: item.filename,
      status: 'failed',
      message: current.errorMessage ?? current.errorCode ?? '解析失败',
      job: current,
    })
  }

  const runSubmittedJob = async (item: Pick<QueuedFile, 'fsId' | 'filename'>, job: ParseJob, prependResult = false) => {
    setQueue((prev) => prev.map((row) => row.fsId === item.fsId ? {
      ...row,
      status: statusFromJob(job),
      jobId: job.id,
      aheadCount: job.ahead_count,
      message: messageFromJob(job),
    } : row))

    const current = await pollJob(job, (next) => {
      setQueue((prev) => prev.map((row) => row.fsId === item.fsId ? {
        ...row,
        status: statusFromJob(next),
        jobId: next.id,
        aheadCount: next.ahead_count,
        message: messageFromJob(next),
      } : row))
    })

    await appendResult(item, current, prependResult)
  }

  const parseSelected = async () => {
    const pending = buildQueue()
    if (pending.length === 0) return
    setExecutionOpen(true)
    setResults([])
    if (activeLocalAccounts.length === 0) {
      setError('当前没有可用账号')
      return
    }
    setError(null)

    for (const item of pending) {
      setQueue((prev) => prev.map((row) => row.fsId === item.fsId ? { ...row, status: 'queued', message: '提交任务中' } : row))
      try {
        if (context.mode === 'disk') {
          const response = await diskResolveMutation.mutateAsync({
            json: {
              accountId: item.accountId || context.accountId,
              fsId: item.fsId,
              path: item.dir === '/' ? `/${item.filename}` : `${item.dir}/${item.filename}`,
              filename: item.filename,
              sizeBytes: item.size,
            },
          })
          const data = response.data
          setQueue((prev) => prev.map((row) => row.fsId === item.fsId ? {
            ...row,
            status: 'success',
            message: '网盘取链成功',
          } : row))
          setResults((prev) => [...prev, {
            fsId: item.fsId,
            filename: item.filename,
            status: 'success',
            message: '网盘取链成功',
            data,
          }])
          await api.api.local.history.$get.invalidate()
          continue
        }

        const submitted = await submitJobMutation.mutateAsync({
          json: {
            shareUrl: context.shareUrl.trim(),
            pwd: context.pwd.trim(),
            dir: item.dir ?? '/',
            fsIds: [item.fsId],
          },
        })
        await runSubmittedJob(item, submitted.data)
      } catch (error) {
        const message = messageFromError(error, '解析失败')
        setQueue((prev) => prev.map((row) => row.fsId === item.fsId ? {
          ...row,
          status: 'failed',
          message,
        } : row))
        setResults((prev) => [...prev, {
          fsId: item.fsId,
          filename: item.filename,
          status: 'failed',
          message,
        }])
      }
    }
  }

  const selectedList = Array.from(selected.values())
  const setWorkspaceMode = (mode: 'share' | 'disk') => {
    setContext((prev) => ({
      ...prev,
      mode,
      dir: '/',
      paths: ['/'],
    }))
  }

  return (
    <>
      <div className="grid gap-5">
        <Panel className="grid gap-5">
          <div className="grid gap-4">
            <div>
              <h2 className="text-xl font-bold">工作台</h2>
            </div>
            <div className={`grid gap-3 ${context.mode === 'share' ? 'md:grid-cols-[220px_minmax(0,1fr)_120px]' : 'md:grid-cols-[220px_220px_minmax(240px,1fr)]'}`}>
              <Field label="浏览模式">
                <ModeSegmentedControl value={context.mode} onChange={setWorkspaceMode} />
              </Field>
              {context.mode === 'share' ? (
                <>
                  <Field label="分享链接">
                    <Input
                      className="w-full"
                      value={context.shareUrl}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        const shareUrl = event.target.value
                        const detected = parsePwd(shareUrl)
                        setContext((prev) => ({ ...prev, shareUrl, pwd: detected }))
                      }}
                      placeholder="https://pan.xxx.com/s/1..."
                    />
                  </Field>
                  <Field label="提取码">
                    <Input className="w-full" maxLength={4} value={context.pwd} onChange={(event: ChangeEvent<HTMLInputElement>) => setContext((prev) => ({ ...prev, pwd: event.target.value }))} placeholder="可留空" />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="账号">
                    <Select className="w-full" value={String(context.accountId)} onChange={(event: ChangeEvent<HTMLSelectElement>) => setContext((prev) => ({ ...prev, accountId: Number(event.target.value), dir: '/', paths: ['/'] }))}>
                      <option value="0">选择账号</option>
                      {activeLocalAccounts.map((account) => (
                        <option key={account.id} value={account.id}>{account.baiduName || account.label}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="当前目录">
                    <Input className="w-full" value={context.dir} onChange={(event: ChangeEvent<HTMLInputElement>) => setContext((prev) => ({ ...prev, dir: event.target.value }))} />
                  </Field>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={shareFilesMutation.isPending || Boolean(currentNode?.loading)} onClick={refreshRoot}>
                {shareFilesMutation.isPending || currentNode?.loading ? <Loader2 className="size-4 animate-spin" /> : context.mode === 'disk' ? <HardDrive className="size-4" /> : <Link2 className="size-4" />}
                {context.mode === 'disk' ? '读取网盘目录' : '获取分享文件'}
              </Button>
              <Button disabled={selectedList.length === 0 || submitJobMutation.isPending || diskResolveMutation.isPending} onClick={parseSelected} variant="secondary">
                <Download className="size-4" />
                解析 {selectedList.length ? `${selectedList.length} 个` : ''}
              </Button>
              {selectedList.length > 0 ? (
                <Button onClick={() => setSelected(new Map())} size="sm" variant="secondary">
                  <X className="size-4" />
                  取消选择
                </Button>
              ) : null}
              <Button onClick={() => setExecutionOpen(true)} variant="secondary">
                <ListChecks className="size-4" />
                执行面板
                {executionCount > 0 ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                    {executionCount}
                  </span>
                ) : null}
              </Button>
              {selectedList.length > 0 ? (
                <span className="text-sm text-slate-500">
                  已选 {selectedList.length} 个，合计 {formatBytes(selectedList.reduce((sum, file) => sum + file.size, 0))}
                </span>
              ) : null}
              <span className={`inline-flex items-center gap-1 text-sm ${activeLocalAccounts.length > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {activeLocalAccounts.length > 0 ? `可用账号 ${activeLocalAccounts.length} 条` : '当前没有可用账号'}
              </span>
            </div>
          </div>
          <BrowserHeader dir={context.dir} nodes={nodes} onNavigate={(dir) => loadDirectory(dir)} />
          <FileTree
            currentDir={context.dir}
            node={currentNode}
            nodes={nodes}
            selected={selected}
            onEnter={enterDirectory}
            onLoadMore={loadMore}
            onRetryDirectory={retryDirectory}
            onToggleDirectory={toggleDirectory}
            onToggleDirectorySelection={toggleDirectorySelection}
            onToggleFile={toggleFile}
          />
        </Panel>
      </div>
      <ExecutionDrawer
        downloaders={downloaders}
        open={executionOpen}
        queueCount={queue.length}
        resultCount={results.length}
        results={results}
        onNotify={pushNotification}
        onError={setError}
        onDefaultDownloaderChange={(downloaderId) => void setDefaultDownloader(downloaderId)}
        onClose={() => setExecutionOpen(false)}
      />
      <Modal
        description="这个 Cookie 只用于读取百度网盘分享目录，并会保存在当前浏览器的本地存储中，后续目录请求会优先使用这里填写的值。"
        maxWidthClassName="max-w-3xl"
        onClose={closeCookieModal}
        open={cookieModalOpen}
        title="填写分享目录 Cookie"
      >
        <div className="grid gap-4">
          <Field label="Cookie" hint="填写后点击保存并继续，当前这次目录读取会立即使用新的 Cookie。">
            <Textarea
              className="min-h-20 w-full min-w-0 resize-y font-mono text-xs"
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                setCookieDraft(event.target.value)
                if (cookieDraftError) setCookieDraftError(null)
              }}
              value={cookieDraft}
            />
          </Field>
          {cookieDraftError ? <div className="text-sm font-semibold text-red-600">{cookieDraftError}</div> : null}
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
            <div className="font-bold">合规提示</div>
            <div>请仅填写通过合法合规渠道取得、且你有权用于读取该分享目录的 Cookie。不要填写他人账号、来源不明账号或未经授权的 Cookie。</div>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
            <div className="font-bold">风险提示</div>
            <div>下面展示的示例 Cookie 来自公开网络，来源无法核验，可能带来合规风险。强烈建议不要使用它。</div>
          </div>
          <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-sm font-semibold text-slate-700">来源未知的内置示例 Cookie</div>
            <Textarea
              className="min-h-16 w-full min-w-0 resize-y font-mono text-xs text-slate-600"
              readOnly
              value={shareCookieTemplateQuery.isPending ? '正在读取内置模板...' : fakeCookieTemplate}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={closeCookieModal} variant="secondary">取消</Button>
            <Button disabled={shareFilesMutation.isPending} onClick={() => void saveCookieAndContinue()}>
              {shareFilesMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              保存并继续
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function ExecutionDrawer({
  downloaders,
  open,
  queueCount,
  resultCount,
  results,
  onNotify,
  onError,
  onDefaultDownloaderChange,
  onClose,
}: {
  downloaders: DownloaderConfig[]
  open: boolean
  queueCount: number
  resultCount: number
  results: ParseResult[]
  onNotify: (input: { variant: 'success' | 'error' | 'warning' | 'info', message: string }) => void
  onError: (message: string | null) => void
  onDefaultDownloaderChange: (downloaderId: string) => void
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useAtom(executionTabAtom)

  return (
    <div className={`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <button
        aria-label="关闭执行面板"
        className={`absolute inset-0 bg-slate-950/30 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        tabIndex={open ? 0 : -1}
        type="button"
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-full max-w-[480px] flex-col border-l border-slate-200 bg-white shadow-2xl shadow-slate-950/20 transition-transform duration-200 max-sm:max-w-none ${open ? 'translate-x-0' : 'translate-x-full'}`}
        role="dialog"
        aria-modal="true"
        aria-label="执行面板"
      >
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900">执行面板</h3>
          </div>
          <button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" type="button" aria-label="关闭" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden p-5">
          <div className="flex flex-wrap rounded-lg bg-slate-100 p-1">
            {[
              { key: 'queue' as const, label: '队列', count: queueCount },
              { key: 'results' as const, label: '结果', count: resultCount },
            ].map((tab) => (
              <button
                className={`rounded-md px-3 py-2 text-sm font-semibold transition ${activeTab === tab.key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                type="button"
              >
                <span>{tab.label}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${activeTab === tab.key ? 'bg-blue-50 text-blue-700' : 'bg-white text-slate-500'}`}>{tab.count}</span>
              </button>
            ))}
          </div>
          <div className="min-h-0 overflow-y-auto pr-1">
            {activeTab === 'queue' ? <QueuePanel /> : (
              <ResultPanel
                downloaders={downloaders}
                results={results}
                onError={onError}
                onNotify={onNotify}
                onDefaultDownloaderChange={onDefaultDownloaderChange}
              />
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

function BrowserHeader({
  dir,
  nodes,
  onNavigate,
}: {
  dir: string
  nodes: Record<string, DirectoryNode>
  onNavigate: (dir: string) => Promise<void>
}) {
  const crumbs = collapseBreadcrumbs(dir, nodes)
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
      {crumbs.map((item, index) => (
        <div className="flex items-center gap-1" key={item.path}>
          {index > 0 ? <ChevronRight className="size-4 text-slate-400" /> : null}
          <button
            className={`min-w-0 rounded px-2 py-1 font-semibold ${item.path === dir ? 'text-slate-900' : 'text-blue-700 hover:bg-blue-50'}`}
            disabled={item.path === dir}
            type="button"
            onClick={() => onNavigate(item.path)}
          >
            {item.label === '全部文件' ? item.label : <MiddleEllipsis text={item.label} className="max-w-[220px]" />}
          </button>
        </div>
      ))}
    </div>
  )
}

function FileTree({
  currentDir,
  node,
  nodes,
  selected,
  onEnter,
  onLoadMore,
  onRetryDirectory,
  onToggleDirectory,
  onToggleDirectorySelection,
  onToggleFile,
}: {
  currentDir: string
  node?: DirectoryNode
  nodes: Record<string, DirectoryNode>
  selected: Map<number, SelectedFile>
  onEnter: (file: ShareFile, parentDir: string) => void
  onLoadMore: (dir: string) => void
  onRetryDirectory: (dir: string) => void
  onToggleDirectory: (file: ShareFile, parentDir: string) => void
  onToggleDirectorySelection: (dir: string, checked: boolean) => void
  onToggleFile: (file: ShareFile, dir: string, checked: boolean) => void
}) {
  if (node?.loading && !node.loaded) return <EmptyState title="正在读取文件列表" />
  if (!node?.loaded) return <EmptyState title="还没有文件列表" />
  if (node.files.length === 0) return <EmptyState title="当前目录为空" />

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="grid grid-cols-[minmax(0,1fr)_120px_140px] bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 max-md:grid-cols-[minmax(0,1fr)_92px]">
        <div>名称</div>
        <div>大小</div>
        <div className="max-md:hidden">修改时间</div>
      </div>
      <div className="divide-y divide-slate-100">
        <DirectoryRows
          depth={0}
          dir={currentDir}
          node={node}
          nodes={nodes}
          selected={selected}
          onEnter={onEnter}
          onLoadMore={onLoadMore}
          onRetryDirectory={onRetryDirectory}
          onToggleDirectory={onToggleDirectory}
          onToggleDirectorySelection={onToggleDirectorySelection}
          onToggleFile={onToggleFile}
        />
      </div>
    </div>
  )
}

function DirectoryRows({
  depth,
  dir,
  node,
  nodes,
  selected,
  onEnter,
  onLoadMore,
  onRetryDirectory,
  onToggleDirectory,
  onToggleDirectorySelection,
  onToggleFile,
}: {
  depth: number
  dir: string
  node: DirectoryNode
  nodes: Record<string, DirectoryNode>
  selected: Map<number, SelectedFile>
  onEnter: (file: ShareFile, parentDir: string) => void
  onLoadMore: (dir: string) => void
  onRetryDirectory: (dir: string) => void
  onToggleDirectory: (file: ShareFile, parentDir: string) => void
  onToggleDirectorySelection: (dir: string, checked: boolean) => void
  onToggleFile: (file: ShareFile, dir: string, checked: boolean) => void
}) {
  return (
    <>
      {node.files.map((file) => {
        const merged = file.is_dir ? resolveMergedDirectory(file, dir, nodes) : null
        const childDir = merged?.dir ?? (file.is_dir ? (file.path || joinPath(dir, file.server_filename)) : '')
        const child = childDir ? nodes[childDir] : undefined
        return (
          <div key={`${dir}:${file.fs_id}`}>
            <FileRow
              depth={depth}
              dir={dir}
              file={file}
              merged={merged}
              selected={selected.has(file.fs_id)}
              selectedMap={selected}
              childNode={child}
              onEnter={onEnter}
              onLoadMore={onLoadMore}
              onToggleDirectory={onToggleDirectory}
              onToggleDirectorySelection={onToggleDirectorySelection}
              onToggleFile={onToggleFile}
            />
            {file.is_dir && child?.expanded ? (
              child.loading && !child.loaded ? (
                <IndentedRow depth={depth + 1}>
                  <Loader2 className="size-4 animate-spin text-blue-600" />
                  <span>正在加载子目录...</span>
                </IndentedRow>
              ) : child.error ? (
                <IndentedRow depth={depth + 1}>
                  <span className="text-red-600">{child.error}</span>
                  <Button className="min-h-8 px-2 py-1 text-xs" onClick={() => onRetryDirectory(childDir)} variant="secondary">重试</Button>
                </IndentedRow>
              ) : child.files.length > 0 ? (
                <DirectoryRows
                  depth={depth + 1}
                  dir={childDir}
                  node={child}
                  nodes={nodes}
                  selected={selected}
                  onEnter={onEnter}
                  onLoadMore={onLoadMore}
                  onRetryDirectory={onRetryDirectory}
                  onToggleDirectory={onToggleDirectory}
                  onToggleDirectorySelection={onToggleDirectorySelection}
                  onToggleFile={onToggleFile}
                />
              ) : (
                <IndentedRow depth={depth + 1}>子目录为空</IndentedRow>
              )
            ) : null}
          </div>
        )
      })}
      {node.hasMore ? (
        <IndentedRow depth={depth}>
          <Button className="min-h-9 px-3 py-1.5" disabled={node.loading} onClick={() => onLoadMore(dir)} variant="secondary">
            {node.loading ? <Loader2 className="size-4 animate-spin" /> : <ChevronDown className="size-4" />}
            加载更多
          </Button>
          <span className="text-xs text-slate-500">已加载 {node.files.length} 条</span>
        </IndentedRow>
      ) : null}
    </>
  )
}

function FileRow({
  depth,
  dir,
  file,
  merged,
  selected,
  selectedMap,
  childNode,
  onEnter,
  onLoadMore,
  onToggleDirectory,
  onToggleDirectorySelection,
  onToggleFile,
}: {
  depth: number
  dir: string
  file: ShareFile
  merged?: MergedDirectoryView | null
  selected: boolean
  selectedMap: Map<number, SelectedFile>
  childNode?: DirectoryNode
  onEnter: (file: ShareFile, parentDir: string) => void
  onLoadMore: (dir: string) => void
  onToggleDirectory: (file: ShareFile, parentDir: string) => void
  onToggleDirectorySelection: (dir: string, checked: boolean) => void
  onToggleFile: (file: ShareFile, dir: string, checked: boolean) => void
}) {
  const displayLabel = merged?.label ?? file.server_filename
  const childDir = merged?.dir ?? (file.is_dir ? directoryPathFor(file, dir) : '')
  const childFiles = directoryFiles(childNode)
  const allSelected = childFiles.length > 0 && childFiles.every((item) => hasSelectedFsId(selectedMap, item.fs_id))
  return (
    <div className={`grid min-h-14 grid-cols-[minmax(0,1fr)_120px_140px] items-center px-3 py-2 text-sm max-md:grid-cols-[minmax(0,1fr)_92px] ${file.is_dir ? 'bg-slate-50/40 hover:bg-slate-50' : 'hover:bg-slate-50/70'}`}>
      <div className="min-w-0" style={{ paddingLeft: `${treeIndentPx(depth)}px` }}>
        <div className="grid min-w-0 grid-cols-[36px_minmax(0,1fr)] items-center gap-2 rounded-md px-1 py-0.5">
          {file.is_dir ? (
            <HoverTooltip
              content={
                !childNode?.expanded
                  ? `展开 ${displayLabel} 并开始加载文件`
                  : !childNode?.loaded || childNode.loading
                    ? `正在加载 ${displayLabel}`
                    : childNode.error
                      ? `${displayLabel} 加载失败，点击重试`
                      : childNode.hasMore
                        ? `继续拉取 ${displayLabel}，加载完后才能整目录选择`
                        : childFiles.length === 0
                          ? `${displayLabel} 已完整加载，但当前层没有可选文件`
                          : `${displayLabel} 已完整加载，可一键选择当前层全部文件`
              }
            >
              <button
                aria-label={
                  !childNode?.expanded
                    ? '展开目录'
                    : !childNode?.loaded || childNode.loading
                      ? '正在加载目录'
                      : childNode.error
                        ? '重试目录加载'
                        : childNode.hasMore
                          ? '继续拉取目录'
                          : '选择目录中的文件'
                }
                className="flex h-8 w-8 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
                type="button"
                onClick={() => {
                  if (!childNode?.expanded) {
                    void onToggleDirectory(file, dir)
                    return
                  }
                  if (!childNode.loaded || childNode.loading) return
                  if (childNode.error) {
                    void onLoadMore(childDir)
                    return
                  }
                  if (childNode.hasMore) {
                    void onLoadMore(childDir)
                    return
                  }
                  if (childFiles.length > 0) {
                    onToggleDirectorySelection(childDir, !allSelected)
                  }
                }}
              >
                {!childNode?.expanded ? (
                  <ChevronRight className="size-4" />
                ) : !childNode?.loaded || childNode.loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : childNode.error ? (
                  <RefreshCw className="size-4" />
                ) : childNode.hasMore ? (
                  <RefreshCw className="size-4" />
                ) : allSelected ? (
                  <CheckSquare className="size-5 text-blue-600" />
                ) : (
                  <Square className={`size-5 ${childFiles.length === 0 ? 'text-slate-300' : ''}`} />
                )}
              </button>
            </HoverTooltip>
          ) : (
            <button aria-label={selected ? '取消选择' : '选择文件'} className="flex h-8 w-8 items-center justify-center rounded text-slate-500 hover:bg-slate-100" type="button" onClick={() => onToggleFile(file, dir, !selected)}>
              {selected ? <CheckSquare className="size-5 text-blue-600" /> : <Square className="size-5" />}
            </button>
          )}
          <button className={`flex min-w-0 items-center gap-3 text-left ${file.is_dir ? 'font-semibold text-slate-900' : 'text-slate-800'}`} type="button" onClick={() => file.is_dir ? onEnter({ ...file, path: childDir, server_filename: displayLabel }, dir) : onToggleFile(file, dir, !selected)}>
            <span className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${file.is_dir ? 'bg-slate-200/80 text-slate-700' : 'bg-slate-100 text-slate-400'}`}>
              {depth > 0 ? <span className="absolute -left-2 top-1/2 h-px w-2 bg-slate-300" /> : null}
              {file.is_dir ? <Folder className="size-4.5" /> : <File className="size-4.5" />}
            </span>
            <MiddleEllipsis text={displayLabel} className={file.is_dir ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'} />
          </button>
        </div>
      </div>
      <div className="text-slate-500">
        {file.is_dir ? '-' : formatBytes(file.size)}
      </div>
      <div className="text-slate-500 max-md:hidden">{formatDateTime(file.server_mtime ? file.server_mtime * 1000 : null)}</div>
    </div>
  )
}

function IndentedRow({ depth, children }: { depth: number, children: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-2 bg-slate-50/60 px-3 py-2 text-sm text-slate-500" style={{ paddingLeft: `${treeIndentPx(depth) + 48}px` }}>
      {children}
    </div>
  )
}

function QueuePanel() {
  const queue = useAtomValue(parseQueueAtom)
  const pagination = usePagination(queue, 5)
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">解析队列</h3>
        <span className="text-xs text-slate-500">{queue.length} 个文件</span>
      </div>
      {queue.length === 0 ? (
        <EmptyState title="暂无队列" />
      ) : (
        <div className="grid gap-2">
          {pagination.pageItems.map((item) => (
            <div className="rounded-lg border border-slate-200 p-3" key={`${item.fsId}:${item.jobId ?? 'pending'}`}>
              <div className="flex items-start gap-2">
                <StateIcon status={item.status} />
                <div className="min-w-0 flex-1">
                  <MiddleEllipsis text={item.filename} className="text-sm font-semibold" />
                  <div className="mt-1 text-xs text-slate-500">
                    {item.size > 0 ? `${formatBytes(item.size)} · ` : ''}{item.message ?? item.status}
                    {item.jobId ? ` · 任务 #${item.jobId}` : ''}
                  </div>
                </div>
              </div>
            </div>
          ))}
          <Pagination {...pagination} onPageChange={pagination.setPage} />
        </div>
      )}
    </div>
  )
}

function ResultPanel({
  downloaders,
  results,
  onNotify,
  onError,
  onDefaultDownloaderChange,
}: {
  downloaders: DownloaderConfig[]
  results: ParseResult[]
  onNotify: (input: { variant: 'success' | 'error' | 'warning' | 'info', message: string }) => void
  onError: (message: string | null) => void
  onDefaultDownloaderChange: (downloaderId: string) => void
}) {
  const pagination = usePagination(results, 5)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const allDownloadable = results
    .map(downloadableFromResult)
    .filter((item): item is DownloadableItem => item !== null)
  const selectedItems = allDownloadable.filter((item) => selected.has(item.id))
  const pageDownloadable = pagination.pageItems
    .map((result, index) => downloadableFromResult(result, (pagination.page - 1) * pagination.pageSize + index))
    .filter((item): item is DownloadableItem => item !== null)
  const pageAllSelected = pageDownloadable.length > 0 && pageDownloadable.every((item) => selected.has(item.id))
  const sendItems = async (downloader: DownloaderConfig, items: DownloadableItem[]) => {
    if (items.length === 0) return
    setSending(true)
    onError(null)
    try {
      const sent = await sendManyToDownloader(downloader, items)
      const failed = sent.filter((item) => !item.ok)
      onNotify({
        variant: failed.length > 0 ? 'warning' : 'success',
        message: `${downloader.name}: ${summarizeSendResults(sent)}`,
      })
      if (failed[0]?.error) onError(failed[0].error)
    } finally {
      setSending(false)
    }
  }
  const toggleSelected = (item: DownloadableItem, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(item.id)
      else next.delete(item.id)
      return next
    })
  }
  const togglePageSelected = () => {
    setSelected((current) => {
      const next = new Set(current)
      for (const item of pageDownloadable) {
        if (pageAllSelected) next.delete(item.id)
        else next.add(item.id)
      }
      return next
    })
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">解析结果</h3>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">{results.length} 条</span>
          <Button disabled={pageDownloadable.length === 0} onClick={togglePageSelected} size="sm" variant="secondary">
            {pageAllSelected ? '取消本页' : '选择本页'}
          </Button>
          <DownloaderSendButton
            downloaders={downloaders}
            items={selectedItems}
            onDefaultChange={onDefaultDownloaderChange}
            pending={sending}
            onSend={(downloader, items) => void sendItems(downloader, items)}
          />
        </div>
      </div>
      {results.length === 0 ? (
        <EmptyState title="暂无结果" />
      ) : (
        <div className="grid gap-3">
          {pagination.pageItems.map((result, index) => (
            <div className={`rounded-lg border p-3 ${result.status === 'success' ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40'}`} key={`${result.job?.id ?? result.data?.record_id ?? result.fsId}-${result.status}-${index}`}>
              <div className="flex items-start gap-2">
                {(() => {
                  const item = downloadableFromResult(result, (pagination.page - 1) * pagination.pageSize + index)
                  return item ? (
                    <button aria-label="选择下载任务" className="mt-0.5 flex size-5 items-center justify-center rounded text-slate-500 hover:bg-white/70" onClick={() => toggleSelected(item, !selected.has(item.id))} type="button">
                      {selected.has(item.id) ? <CheckSquare className="size-5 text-blue-600" /> : <Square className="size-5" />}
                    </button>
                  ) : <StateIcon status={result.status} />
                })()}
                <div className="min-w-0 flex-1">
                  <MiddleEllipsis text={result.filename} className="text-sm font-bold" />
                  <div className="mt-1 text-xs text-slate-600">{result.message}</div>
                </div>
              </div>
              {result.status === 'success' && result.data ? (
                <div className="mt-3 grid gap-2 text-xs">
                  <div className="rounded-md bg-white px-3 py-2 text-slate-600 ring-1 ring-slate-200">
                    账号 {result.data.account_id} · {result.data.parseRoute ? `${result.data.credentialSource}.${result.data.parseRoute}` : '-'}
                  </div>
                  <div className="break-all rounded-md bg-white px-3 py-2 text-slate-600 ring-1 ring-slate-200">UA: {result.data.ua}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button className="min-h-9 px-3 py-1.5" onClick={() => copyText(result.data?.urls[0] ?? '')} variant="secondary">
                      <Copy className="size-4" />
                      复制直链
                    </Button>
                    <Button className="min-h-9 px-3 py-1.5" onClick={() => copyText(result.data?.ua ?? '')} variant="secondary">
                      <Clipboard className="size-4" />
                      复制 UA
                    </Button>
                    {(() => {
                      const item = downloadableFromResult(result, (pagination.page - 1) * pagination.pageSize + index)
                      return item ? (
                        <DownloaderSendButton
                          downloaders={downloaders}
                          items={[item]}
                          menu={false}
                          pending={sending}
                          onSend={(downloader, items) => void sendItems(downloader, items)}
                        />
                      ) : null
                    })()}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          <Pagination {...pagination} onPageChange={pagination.setPage} />
        </div>
      )}
    </div>
  )
}
