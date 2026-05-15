export const parsePwd = (url: string) => {
  const match = url.match(/(?:pwd=|提取码[:：]?\s*)([A-Za-z0-9]{4})/i)
  return match ? match[1] : ''
}

export const formatBytes = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = size
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`
}

export const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`

export const formatDateTime = (value?: Date | string | number | null) => {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export const joinPath = (base: string, name: string) => {
  if (base === '/') return `/${name}`
  return `${base.replace(/\/$/, '')}/${name}`
}

export const pathParts = (path: string) => {
  if (!path || path === '/') return [{ label: '全部文件', path: '/' }]
  const segments = path.split('/').filter(Boolean)
  return [
    { label: '全部文件', path: '/' },
    ...segments.map((segment, index) => ({
      label: segment,
      path: `/${segments.slice(0, index + 1).join('/')}`,
    })),
  ]
}
