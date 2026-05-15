import { atom } from 'jotai'
import { atomWithStorage, createJSONStorage } from 'jotai/utils'
import type { ParseJob, ParsedLink, ShareFile } from './api'

export type WorkspaceMode = 'share' | 'disk'
export type ExecutionTab = 'queue' | 'results'

export type WorkspaceContext = {
  mode: WorkspaceMode
  shareUrl: string
  pwd: string
  dir: string
  paths: string[]
  accountId: number
}

export type SelectedFile = {
  fsId: number
  filename: string
  size: number
  dir: string
  path?: string
  accountId?: number
}

export type ParseResult = {
  fsId: number
  filename: string
  status: 'success' | 'failed'
  message: string
  data?: ParsedLink
  job?: ParseJob
}

export type QueuedFile = {
  fsId: number
  filename: string
  size: number
  dir?: string
  accountId?: number
  status: 'waiting' | 'queued' | 'running' | 'success' | 'failed'
  message?: string
  jobId?: number
  aheadCount?: number
}

export type WorkspaceDirectoryNode = {
  dir: string
  files: ShareFile[]
  page: number
  hasMore: boolean
  loading: boolean
  error: string | null
  expanded: boolean
  loaded: boolean
}

export type WorkspaceSnapshot = {
  context: WorkspaceContext
  selectedFiles: SelectedFile[]
  diskFiles: ShareFile[]
  nodes: Record<string, WorkspaceDirectoryNode>
  executionOpen: boolean
  executionTab: ExecutionTab
  updatedAt: number
}

export type ParseExecutionSnapshot = {
  queue: QueuedFile[]
  results: ParseResult[]
  updatedAt: number
}

type ValueOrUpdater<T> = T | ((prev: T) => T)
export type NotificationVariant = 'success' | 'error' | 'warning' | 'info'
export type AppNotification = {
  id: string
  variant: NotificationVariant
  message: string
}
export type NotificationInput = {
  variant: NotificationVariant
  message: string
}

const parseExecutionStorageKey = 'lc-agent.local-parse-execution.v1'
const workspaceStorageKey = 'lc-agent.workspace.v1'
const shareCookieStorageKey = 'lc-agent.share-directory-cookie.v1'
const queuedStatuses = new Set<QueuedFile['status']>(['waiting', 'queued', 'running', 'success', 'failed'])
const resultStatuses = new Set<ParseResult['status']>(['success', 'failed'])
const workspaceModes = new Set<WorkspaceMode>(['share', 'disk'])
const executionTabs = new Set<ExecutionTab>(['queue', 'results'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object'

const numberFrom = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const numberValue = Number(value)
    if (Number.isFinite(numberValue)) return numberValue
  }
  return null
}

const numberOr = (value: unknown, fallback = 0) => numberFrom(value) ?? fallback

const stringOr = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback

const booleanOr = (value: unknown, fallback = false) => {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return fallback
}

const normalizeDir = (value: unknown, fallback = '/') => {
  const dir = stringOr(value, fallback).trim()
  if (!dir) return fallback
  return dir.startsWith('/') ? dir : `/${dir}`
}

const isQueuedFile = (value: unknown): value is QueuedFile => {
  if (!isRecord(value)) return false
  return (
    typeof value.fsId === 'number' &&
    typeof value.filename === 'string' &&
    typeof value.size === 'number' &&
    typeof value.status === 'string' &&
    queuedStatuses.has(value.status as QueuedFile['status'])
  )
}

const isParseResult = (value: unknown): value is ParseResult => {
  if (!isRecord(value)) return false
  return (
    typeof value.fsId === 'number' &&
    typeof value.filename === 'string' &&
    typeof value.message === 'string' &&
    typeof value.status === 'string' &&
    resultStatuses.has(value.status as ParseResult['status'])
  )
}

const normalizeShareFile = (value: unknown): ShareFile | null => {
  if (!isRecord(value)) return null
  const fsId = numberFrom(value.fs_id)
  const filename = stringOr(value.server_filename)
  if (fsId === null || !filename) return null
  return {
    category: numberOr(value.category),
    fs_id: fsId,
    is_dir: booleanOr(value.is_dir),
    local_ctime: numberOr(value.local_ctime),
    local_mtime: numberOr(value.local_mtime),
    md5: stringOr(value.md5),
    path: stringOr(value.path),
    server_ctime: numberOr(value.server_ctime),
    server_mtime: numberOr(value.server_mtime),
    server_filename: filename,
    size: numberOr(value.size),
    dlink: stringOr(value.dlink),
  }
}

const normalizeShareFiles = (value: unknown) =>
  Array.isArray(value) ? value.map(normalizeShareFile).filter((item): item is ShareFile => item !== null) : []

const normalizeSelectedFile = (value: unknown): SelectedFile | null => {
  if (!isRecord(value)) return null
  const fsId = numberFrom(value.fsId)
  const size = numberFrom(value.size)
  const filename = stringOr(value.filename)
  if (fsId === null || size === null || !filename) return null
  const accountId = numberFrom(value.accountId)
  return {
    fsId,
    filename,
    size,
    dir: normalizeDir(value.dir),
    path: stringOr(value.path) || undefined,
    accountId: accountId === null ? undefined : accountId,
  }
}

const normalizeWorkspaceContext = (value: unknown): WorkspaceContext => {
  const record = isRecord(value) ? value : {}
  const mode = typeof record.mode === 'string' && workspaceModes.has(record.mode as WorkspaceMode)
    ? record.mode as WorkspaceMode
    : 'share'
  const dir = normalizeDir(record.dir)
  const paths = Array.isArray(record.paths)
    ? record.paths.map((item) => normalizeDir(item)).filter((item, index, list) => item === '/' || list.indexOf(item) === index)
    : []
  const accountId = Math.max(0, Math.trunc(numberOr(record.accountId)))
  return {
    mode,
    shareUrl: stringOr(record.shareUrl),
    pwd: stringOr(record.pwd),
    dir,
    paths: paths.length > 0 ? paths : ['/'],
    accountId,
  }
}

const normalizeDirectoryNode = (
  value: unknown,
  fallbackDir: string,
  options?: { resetTransient?: boolean },
): WorkspaceDirectoryNode | null => {
  if (!isRecord(value)) return null
  const dir = normalizeDir(value.dir, fallbackDir)
  const files = normalizeShareFiles(value.files)
  return {
    dir,
    files,
    page: Math.max(0, Math.trunc(numberOr(value.page))),
    hasMore: booleanOr(value.hasMore),
    loading: options?.resetTransient ? false : booleanOr(value.loading),
    error: options?.resetTransient ? null : stringOr(value.error) || null,
    expanded: booleanOr(value.expanded),
    loaded: booleanOr(value.loaded, files.length > 0),
  }
}

const emptyParseExecutionSnapshot = (): ParseExecutionSnapshot => ({
  queue: [],
  results: [],
  updatedAt: 0,
})

const emptyWorkspaceSnapshot = (): WorkspaceSnapshot => ({
  context: normalizeWorkspaceContext(null),
  selectedFiles: [],
  diskFiles: [],
  nodes: {},
  executionOpen: false,
  executionTab: 'queue',
  updatedAt: 0,
})

const normalizeParseExecutionSnapshot = (value: unknown): ParseExecutionSnapshot => {
  if (!isRecord(value)) return emptyParseExecutionSnapshot()
  return {
    queue: Array.isArray(value.queue) ? value.queue.filter(isQueuedFile) : [],
    results: Array.isArray(value.results) ? value.results.filter(isParseResult) : [],
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
  }
}

const normalizeWorkspaceSnapshot = (value: unknown): WorkspaceSnapshot => {
  if (!isRecord(value)) return emptyWorkspaceSnapshot()
  const nodes = isRecord(value.nodes)
    ? Object.entries(value.nodes).reduce<Record<string, WorkspaceDirectoryNode>>((acc, [key, node]) => {
      const normalized = normalizeDirectoryNode(node, key, { resetTransient: true })
      if (normalized) acc[normalized.dir] = normalized
      return acc
    }, {})
    : {}
  const executionTab = typeof value.executionTab === 'string' && executionTabs.has(value.executionTab as ExecutionTab)
    ? value.executionTab as ExecutionTab
    : 'queue'
  return {
    context: normalizeWorkspaceContext(value.context),
    selectedFiles: Array.isArray(value.selectedFiles)
      ? value.selectedFiles.map(normalizeSelectedFile).filter((item): item is SelectedFile => item !== null)
      : [],
    diskFiles: normalizeShareFiles(value.diskFiles),
    nodes,
    executionOpen: booleanOr(value.executionOpen),
    executionTab,
    updatedAt: numberOr(value.updatedAt),
  }
}

const normalizeWorkspaceNodes = (value: unknown) =>
  isRecord(value)
    ? Object.entries(value).reduce<Record<string, WorkspaceDirectoryNode>>((acc, [key, node]) => {
      const normalized = normalizeDirectoryNode(node, key)
      if (normalized) acc[normalized.dir] = normalized
      return acc
    }, {})
    : {}

const parseExecutionStorage = createJSONStorage<ParseExecutionSnapshot>(() => window.localStorage, {
  reviver: (_key, value) => value,
  replacer: (_key, value) => value,
})

const workspaceStorage = createJSONStorage<WorkspaceSnapshot>(() => window.sessionStorage, {
  reviver: (_key, value) => value,
  replacer: (_key, value) => value,
})

const shareCookieStorage = createJSONStorage<string>(() => window.localStorage)

export const shareDirectoryCookieAtom = atomWithStorage<string>(
  shareCookieStorageKey,
  '',
  shareCookieStorage,
  {
    getOnInit: true,
  },
)

const parseExecutionSnapshotAtom = atomWithStorage<ParseExecutionSnapshot>(
  parseExecutionStorageKey,
  emptyParseExecutionSnapshot(),
  {
    getItem: (key, initialValue) => normalizeParseExecutionSnapshot(parseExecutionStorage.getItem(key, initialValue)),
    setItem: parseExecutionStorage.setItem,
    removeItem: parseExecutionStorage.removeItem,
    subscribe: parseExecutionStorage.subscribe,
  },
  {
    getOnInit: true,
  },
)

const workspaceSnapshotAtom = atomWithStorage<WorkspaceSnapshot>(
  workspaceStorageKey,
  emptyWorkspaceSnapshot(),
  {
    getItem: (key, initialValue) => normalizeWorkspaceSnapshot(workspaceStorage.getItem(key, initialValue)),
    setItem: workspaceStorage.setItem,
    removeItem: workspaceStorage.removeItem,
    subscribe: workspaceStorage.subscribe,
  },
  {
    getOnInit: true,
  },
)

const selectedFilesToMap = (files: SelectedFile[]) =>
  new Map<number, SelectedFile>(files.map((file) => [file.fsId, file]))

export const notificationsAtom = atom<AppNotification[]>([])
export const pushNotificationAtom = atom(null, (_get, set, input: NotificationInput) => {
  const id = `${Date.now()}:${Math.random().toString(36).slice(2)}`
  set(notificationsAtom, (current) => [
    {
      id,
      variant: input.variant,
      message: input.message,
    },
    ...current,
  ])
})
export const dismissNotificationAtom = atom(null, (_get, set, id: string) => {
  set(notificationsAtom, (current) => current.filter((item) => item.id !== id))
})
export const clearNotificationsAtom = atom(null, (_get, set) => {
  set(notificationsAtom, [])
})
export const errorAtom = atom(
  (get) => get(notificationsAtom).find((item) => item.variant === 'error')?.message ?? null,
  (_get, set, value: string | null) => {
    if (value === null) {
      set(notificationsAtom, (current) => current.filter((item) => item.variant !== 'error'))
      return
    }
    const id = `${Date.now()}:${Math.random().toString(36).slice(2)}`
    set(notificationsAtom, (current) => [
      {
        id,
        variant: 'error',
        message: value,
      },
      ...current,
    ])
  },
)
export const workspaceContextAtom = atom(
  (get) => get(workspaceSnapshotAtom).context,
  (get, set, update: ValueOrUpdater<WorkspaceContext>) => {
    const snapshot = get(workspaceSnapshotAtom)
    const context = typeof update === 'function' ? update(snapshot.context) : update
    set(workspaceSnapshotAtom, {
      ...snapshot,
      context: normalizeWorkspaceContext(context),
      updatedAt: Date.now(),
    })
  },
)
export const selectedFilesAtom = atom(
  (get) => selectedFilesToMap(get(workspaceSnapshotAtom).selectedFiles),
  (get, set, update: ValueOrUpdater<Map<number, SelectedFile>>) => {
    const snapshot = get(workspaceSnapshotAtom)
    const previous = selectedFilesToMap(snapshot.selectedFiles)
    const selected = typeof update === 'function' ? update(previous) : update
    set(workspaceSnapshotAtom, {
      ...snapshot,
      selectedFiles: Array.from(selected.values())
        .map(normalizeSelectedFile)
        .filter((item): item is SelectedFile => item !== null),
      updatedAt: Date.now(),
    })
  },
)
export const diskFilesAtom = atom(
  (get) => get(workspaceSnapshotAtom).diskFiles,
  (get, set, update: ValueOrUpdater<ShareFile[]>) => {
    const snapshot = get(workspaceSnapshotAtom)
    const diskFiles = typeof update === 'function' ? update(snapshot.diskFiles) : update
    set(workspaceSnapshotAtom, {
      ...snapshot,
      diskFiles: normalizeShareFiles(diskFiles),
      updatedAt: Date.now(),
    })
  },
)
export const workspaceNodesAtom = atom(
  (get) => get(workspaceSnapshotAtom).nodes,
  (get, set, update: ValueOrUpdater<Record<string, WorkspaceDirectoryNode>>) => {
    const snapshot = get(workspaceSnapshotAtom)
    const nodes = typeof update === 'function' ? update(snapshot.nodes) : update
    set(workspaceSnapshotAtom, {
      ...snapshot,
      nodes: normalizeWorkspaceNodes(nodes),
      updatedAt: Date.now(),
    })
  },
)
export const executionOpenAtom = atom(
  (get) => get(workspaceSnapshotAtom).executionOpen,
  (get, set, update: ValueOrUpdater<boolean>) => {
    const snapshot = get(workspaceSnapshotAtom)
    const executionOpen = typeof update === 'function' ? update(snapshot.executionOpen) : update
    set(workspaceSnapshotAtom, {
      ...snapshot,
      executionOpen,
      updatedAt: Date.now(),
    })
  },
)
export const executionTabAtom = atom(
  (get) => get(workspaceSnapshotAtom).executionTab,
  (get, set, update: ValueOrUpdater<ExecutionTab>) => {
    const snapshot = get(workspaceSnapshotAtom)
    const executionTab = typeof update === 'function' ? update(snapshot.executionTab) : update
    set(workspaceSnapshotAtom, {
      ...snapshot,
      executionTab: executionTabs.has(executionTab) ? executionTab : 'queue',
      updatedAt: Date.now(),
    })
  },
)
export const parseQueueAtom = atom(
  (get) => get(parseExecutionSnapshotAtom).queue,
  (get, set, update: ValueOrUpdater<QueuedFile[]>) => {
    const snapshot = get(parseExecutionSnapshotAtom)
    const queue = typeof update === 'function' ? update(snapshot.queue) : update
    set(parseExecutionSnapshotAtom, {
      ...snapshot,
      queue,
      updatedAt: Date.now(),
    })
  },
)
export const parseResultsAtom = atom(
  (get) => get(parseExecutionSnapshotAtom).results,
  (get, set, update: ValueOrUpdater<ParseResult[]>) => {
    const snapshot = get(parseExecutionSnapshotAtom)
    const results = typeof update === 'function' ? update(snapshot.results) : update
    set(parseExecutionSnapshotAtom, {
      ...snapshot,
      results,
      updatedAt: Date.now(),
    })
  },
)

export const clearParseExecutionAtom = atom(null, (_get, set) => {
  set(parseExecutionSnapshotAtom, emptyParseExecutionSnapshot())
})
