const allowedCookieKeys = new Set([
  'BDUSS',
  'BDUSS_BFESS',
  'STOKEN',
  'STOKEN_BFESS',
  'PTOKEN',
  'PTOKEN_BFESS',
  'PANWEB',
  'BAIDUID',
  'BAIDUID_BFESS',
  'BIDUPSID',
  'SAVEUSERID',
  'SAVEUSERID_BFESS',
  'USERNAMETYPE',
  'USERNAMETYPE_BFESS',
  'BDCLND',
  'OAUTHSTOKEN',
  'OAUTHSTOKEN_BFESS',
  '_csrf',
  'csrfToken',
])

const requiredCookieKeys = ['BDUSS']

export const normalizeBaiduCookie = (value: string) => {
  const parts = value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)

  const map = new Map<string, string>()
  for (const part of parts) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const key = part.slice(0, index).trim()
    const rawValue = part.slice(index + 1).trim()
    if (!key || !rawValue || rawValue === '-') continue
    if (!allowedCookieKeys.has(key)) continue
    map.set(key, rawValue)
  }

  return Array.from(map.entries())
    .map(([key, entryValue]) => `${key}=${entryValue}`)
    .join('; ')
}

export const hasRequiredBaiduCookieFields = (cookie: string) =>
  requiredCookieKeys.every((key) => cookie.includes(`${key}=`))
