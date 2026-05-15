import { requestJson } from '../lib/http'
import { AppError, upstreamError } from '../lib/errors'

const OPEN_PLATFORM_HOME = 'https://api.oplist.org/'
const OPEN_PLATFORM_RENEW_API = 'https://api.oplist.org/baiduyun/renewapi'
const BAIDU_OAUTH_TOKEN_API = 'https://openapi.baidu.com/oauth/2.0/token'

type RenewApiPayload = {
  access_token?: string
  refresh_token?: string
  expires_in?: number | string
  error?: string
  error_description?: string
  text?: string
}

type RenewApiResponse = RenewApiPayload | {
  code?: number
  data?: RenewApiPayload
  msg?: string
  message?: string
}

export type OpenPlatformRenewOptions = {
  clientKey?: string | null
  secretKey?: string | null
  serverUse?: boolean | null
}

const normalizePayload = (input: RenewApiResponse): RenewApiPayload => {
  if ('data' in input && input.data && typeof input.data === 'object') {
    return input.data
  }
  return input as RenewApiPayload
}

const pickOpenPlatformMessage = (input: unknown): string | null => {
  if (!input || typeof input !== 'object') return null

  const record = input as Record<string, unknown>
  for (const key of ['text', 'error_description', 'message', 'msg', 'error']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  const body = record.body
  if (typeof body === 'string' && body.trim()) {
    try {
      return pickOpenPlatformMessage(JSON.parse(body))
    } catch {
      return body.trim()
    }
  }

  return null
}

const openPlatformErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof AppError) {
    return pickOpenPlatformMessage(error.details) ?? (error.message || fallback)
  }
  if (error instanceof Error) return error.message || fallback
  return fallback
}

export const getOpenPlatformHomeUrl = () => OPEN_PLATFORM_HOME

const normalizeRenewedPayload = (payload: RenewApiPayload) => {
  if (payload.error || payload.error_description || !payload.access_token || !payload.refresh_token) {
    throw upstreamError(
      'OPEN_PLATFORM_TOKEN_INVALID',
      `开放平台 refresh_token 无效: ${payload.error_description ?? payload.text ?? payload.error ?? '未知原因'}`,
      payload,
    )
  }

  const expiresIn = Number(payload.expires_in ?? 0)
  const tokenExpiresAt = new Date(Date.now() + Math.max(60, expiresIn) * 1000)

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn,
    tokenExpiresAt,
  }
}

export const renewOpenPlatformToken = async (refreshToken: string, options: OpenPlatformRenewOptions = {}) => {
  const trimmed = refreshToken.trim()
  if (!trimmed) {
    throw upstreamError('OPEN_PLATFORM_REFRESH_TOKEN_EMPTY', 'refresh_token 不能为空')
  }

  if (options.serverUse === false) {
    const clientKey = options.clientKey?.trim() ?? ''
    const secretKey = options.secretKey?.trim() ?? ''
    if (!clientKey || !secretKey) {
      throw upstreamError('OPEN_PLATFORM_CLIENT_CREDENTIALS_MISSING', '开放平台 AK/SK 不能为空')
    }

    const response = await requestJson<RenewApiPayload>(BAIDU_OAUTH_TOKEN_API, {
      label: 'baidu_oauth_refresh_token',
      method: 'GET',
      headers: {
        'User-Agent': 'pan.baidu.com',
      },
      query: {
        grant_type: 'refresh_token',
        refresh_token: trimmed,
        client_id: clientKey,
        client_secret: secretKey,
      },
    }).catch((error) => {
      throw upstreamError(
        'OPEN_PLATFORM_TOKEN_RENEW_FAILED',
        `开放平台换取 access_token 失败: ${openPlatformErrorMessage(error, '未知原因')}`,
      )
    })

    return normalizeRenewedPayload(response)
  }

  const response = await requestJson<RenewApiResponse>(OPEN_PLATFORM_RENEW_API, {
    label: 'open_platform_renewapi',
    method: 'GET',
    headers: {
      'User-Agent': 'pan.baidu.com',
    },
    query: {
      client_uid: '',
      client_key: '',
      driver_txt: 'baiduyun_go',
      server_use: 'true',
      secret_key: '',
      refresh_ui: trimmed,
    },
  }).catch((error) => {
    throw upstreamError(
      'OPEN_PLATFORM_TOKEN_RENEW_FAILED',
      `开放平台换取 access_token 失败: ${openPlatformErrorMessage(error, '未知原因')}`,
    )
  })

  const payload = normalizePayload(response)
  return normalizeRenewedPayload(payload)
}
