export type DownloaderType = 'motrix' | 'aria2'

export type DownloaderConfig = {
  id: string
  name: string
  type: DownloaderType
  rpcUrl: string
  token: string
  downloadDir: string
  preserveSourceDir: boolean
  enabled: boolean
  isDefault: boolean
}

export type DownloadableItem = {
  id: string
  filename: string
  url: string
  sourceDir?: string | null
  ua?: string | null
}

export type SendToDownloaderResult = {
  item: DownloadableItem
  ok: boolean
  gid?: string
  error?: string
}

const motrixDefaultRpcUrl = 'http://127.0.0.1:16800/jsonrpc'
const aria2DefaultRpcUrl = 'http://127.0.0.1:6800/jsonrpc'

export const defaultDownloaderForType = (type: DownloaderType): DownloaderConfig => ({
  id: `${type}-${Date.now().toString(36)}`,
  name: type === 'motrix' ? 'Motrix' : 'aria2',
  type,
  rpcUrl: type === 'motrix' ? motrixDefaultRpcUrl : aria2DefaultRpcUrl,
  token: '',
  downloadDir: '',
  preserveSourceDir: false,
  enabled: true,
  isDefault: false,
})

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const stringOr = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)

const boolOr = (value: unknown, fallback = false) => (typeof value === 'boolean' ? value : fallback)

const normalizeDownloaderType = (value: unknown): DownloaderType => (value === 'aria2' ? 'aria2' : 'motrix')

const normalizeDownloader = (value: unknown, index: number): DownloaderConfig | null => {
  if (!isRecord(value)) return null
  const type = normalizeDownloaderType(value.type)
  const fallback = defaultDownloaderForType(type)
  const rpcUrl = stringOr(value.rpcUrl, fallback.rpcUrl).trim()
  if (!rpcUrl) return null
  return {
    id: stringOr(value.id, `${type}-${index}-${Date.now().toString(36)}`),
    name: stringOr(value.name, fallback.name).trim() || fallback.name,
    type,
    rpcUrl,
    token: stringOr(value.token).trim(),
    downloadDir: stringOr(value.downloadDir).trim(),
    preserveSourceDir: boolOr(value.preserveSourceDir),
    enabled: boolOr(value.enabled, true),
    isDefault: boolOr(value.isDefault),
  }
}

export const parseDownloaders = (value: string | undefined): DownloaderConfig[] => {
  if (!value?.trim()) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    const normalized = parsed.map(normalizeDownloader).filter((item): item is DownloaderConfig => item !== null)
    if (!normalized.some((item) => item.isDefault) && normalized[0]) {
      return normalized.map((item, index) => ({ ...item, isDefault: index === 0 }))
    }
    let defaultSeen = false
    return normalized.map((item) => {
      if (!item.isDefault) return item
      if (defaultSeen) return { ...item, isDefault: false }
      defaultSeen = true
      return item
    })
  } catch {
    return []
  }
}

export const serializeDownloaders = (downloaders: DownloaderConfig[]) =>
  JSON.stringify(
    downloaders.map((item) => ({
      id: item.id,
      name: item.name.trim(),
      type: item.type,
      rpcUrl: item.rpcUrl.trim(),
      token: item.token.trim(),
      downloadDir: item.downloadDir.trim(),
      preserveSourceDir: item.preserveSourceDir,
      enabled: item.enabled,
      isDefault: item.isDefault,
    })),
  )

export const enabledDownloaders = (downloaders: DownloaderConfig[]) => downloaders.filter((item) => item.enabled && item.rpcUrl.trim())

export const defaultDownloader = (downloaders: DownloaderConfig[]) => {
  const enabled = enabledDownloaders(downloaders)
  return enabled.find((item) => item.isDefault) ?? enabled[0] ?? null
}

const aria2ErrorMessage = (value: unknown) => {
  if (isRecord(value)) {
    const message = value.message
    const code = value.code
    return [code === undefined ? null : `#${String(code)}`, typeof message === 'string' ? message : null].filter(Boolean).join(' ') || '下载器返回错误'
  }
  return '下载器返回错误'
}

const normalizePathSeparators = (value: string) => value.replace(/\\/g, '/')

const stripTrailingSlashes = (value: string) => {
  if (/^[A-Za-z]:\/?$/.test(value)) return value
  if (value === '/') return value
  return value.replace(/\/+$/g, '')
}

export const safeRelativeSourceDir = (sourceDir?: string | null) => {
  const segments = normalizePathSeparators(sourceDir ?? '')
    .split('/')
    .map((item) => item.trim())
    .filter((item) => item && item !== '.' && item !== '..')
  return segments.join('/')
}

export const downloaderTargetDir = (downloader: Pick<DownloaderConfig, 'downloadDir' | 'preserveSourceDir'>, item: Pick<DownloadableItem, 'sourceDir'>) => {
  const base = stripTrailingSlashes(normalizePathSeparators(downloader.downloadDir.trim()))
  const relative = downloader.preserveSourceDir ? safeRelativeSourceDir(item.sourceDir) : ''
  if (!base) return ''
  if (!relative) return base
  return `${base}/${relative}`
}

export const downloaderRequestOptions = (downloader: Pick<DownloaderConfig, 'downloadDir' | 'preserveSourceDir'>, item: Pick<DownloadableItem, 'filename' | 'sourceDir'>) => {
  const targetDir = downloaderTargetDir(downloader, item)
  const relative = downloader.preserveSourceDir && !targetDir ? safeRelativeSourceDir(item.sourceDir) : ''
  return {
    dir: targetDir,
    out: relative ? `${relative}/${item.filename}` : item.filename,
  }
}

export const sendToDownloader = async (downloader: DownloaderConfig, item: DownloadableItem): Promise<string> => {
  const requestOptions = downloaderRequestOptions(downloader, item)
  const options: Record<string, unknown> = {
    out: requestOptions.out,
  }
  if (requestOptions.dir) options.dir = requestOptions.dir
  if (item.ua) options.header = [`User-Agent: ${item.ua}`]

  const params: unknown[] = [[item.url], options]
  if (downloader.token) params.unshift(`token:${downloader.token}`)

  const response = await fetch(downloader.rpcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `lc-agent-${Date.now()}`,
      method: 'aria2.addUri',
      params,
    }),
  })
  const body = (await response.json().catch(() => null)) as unknown
  if (!response.ok) throw new Error(`下载器请求失败 ${response.status}`)
  if (isRecord(body) && body.error) throw new Error(aria2ErrorMessage(body.error))
  if (isRecord(body) && typeof body.result === 'string') return body.result
  throw new Error('下载器响应无效')
}

export const sendManyToDownloader = async (downloader: DownloaderConfig, items: DownloadableItem[]) => {
  const results: SendToDownloaderResult[] = []
  for (const item of items) {
    try {
      const gid = await sendToDownloader(downloader, item)
      results.push({ item, ok: true, gid })
    } catch (error) {
      results.push({
        item,
        ok: false,
        error: error instanceof Error ? error.message : '发送失败',
      })
    }
  }
  return results
}

export const summarizeSendResults = (results: SendToDownloaderResult[]) => {
  const success = results.filter((item) => item.ok).length
  const failed = results.length - success
  if (failed === 0) return `已发送 ${success} 个下载任务`
  if (success === 0) return `发送失败 ${failed} 个`
  return `已发送 ${success} 个，失败 ${failed} 个`
}
