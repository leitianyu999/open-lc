import { badRequest } from '../lib/errors'

export const parseShareUrl = (shareUrl: string) => {
  const trimmed = shareUrl.trim()
  if (!trimmed) throw badRequest('BAD_SHARE_URL', '分享链接不能为空')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw badRequest('BAD_SHARE_URL', '分享链接格式不正确')
  }

  const surlParam = url.searchParams.get('surl')
  if (surlParam) return normalizeSurl(surlParam)

  const match = url.pathname.match(/\/s\/(?:1)?([A-Za-z0-9_-]+)/)
  if (match?.[1]) return normalizeSurl(match[1])

  throw badRequest('BAD_SHARE_URL', '无法从分享链接中识别 surl')
}

export const normalizeSurl = (surl: string) => {
  const value = surl.trim().replace(/^1/, '')
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw badRequest('BAD_SHARE_URL', 'surl 格式不正确')
  }
  return value
}

export const parseSharePwd = (shareUrl: string) => {
  try {
    const url = new URL(shareUrl.trim())
    return url.searchParams.get('pwd') ?? undefined
  } catch {
    return undefined
  }
}

export const decodeSecKey = (seckey: string) => seckey.replaceAll('-', '+').replaceAll('~', '=').replaceAll('_', '/')
