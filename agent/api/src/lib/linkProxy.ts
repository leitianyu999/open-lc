import crypto from 'node:crypto'
import { getDownloadSettings, getSettingWithSource, setSetting } from '../settings/service'

const version = 'v1'
const keyId = 'k1'
const aad = `${version}.${keyId}`

const base64url = (buffer: Buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const deriveKey = (secret: string) => crypto.createHash('sha256').update(secret).digest()

const encryptPayload = (payload: Record<string, unknown>, secret: string) => {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret), iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return base64url(Buffer.concat([iv, ciphertext, tag]))
}

const isPcsUrl = (value: string) => {
  try {
    return new URL(value).hostname === 'pcs.baidu.com'
  } catch {
    return false
  }
}

const contentTypeForFilename = (filename?: string | null) => {
  const lower = (filename ?? '').toLowerCase()
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.mkv')) return 'video/x-matroska'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  return undefined
}

export const getLinkProxyConfig = () => {
  const baseUrl = getSettingWithSource('linkProxyBaseUrl')
  const secret = getSettingWithSource('linkProxySecret')
  return {
    baseUrl: baseUrl.value,
    secret: secret.value,
    baseUrlSource: baseUrl.source === 'database' ? 'admin' : baseUrl.source === 'default' ? 'none' : baseUrl.source,
    secretSource: secret.source === 'database' ? 'admin' : secret.source === 'default' ? 'none' : secret.source,
    enabled: Boolean(baseUrl.value && secret.value),
  }
}

export const setLinkProxyConfig = (input: { baseUrl?: unknown; secret?: unknown }) => {
  if (Object.hasOwn(input, 'baseUrl')) {
    setSetting('linkProxyBaseUrl', input.baseUrl)
  }
  if (Object.hasOwn(input, 'secret')) {
    setSetting('linkProxySecret', input.secret)
  }
  return getLinkProxyConfig()
}

export const createProxiedDownloadUrl = (
  rawUrl: string,
  input?: {
    filename?: string | null
    expiresAt?: Date | null
  },
) => {
  const proxy = getLinkProxyConfig()
  if (!proxy.enabled || !isPcsUrl(rawUrl)) return rawUrl

  try {
    const exp = input?.expiresAt ? Math.floor(input.expiresAt.getTime() / 1000) : Math.floor(Date.now() / 1000) + getDownloadSettings().linkCacheTtlSeconds
    const token = encryptPayload(
      {
        url: rawUrl,
        exp,
        filename: input?.filename ?? undefined,
        contentType: contentTypeForFilename(input?.filename),
      },
      proxy.secret,
    )
    return `${proxy.baseUrl}/lc/${version}.${keyId}.${token}?download=1`
  } catch {
    return rawUrl
  }
}
