import { db } from '../db'
import { accountHealthChecks } from '../db/schema'
import { AppError, badRequest } from '../lib/errors'
import { getAccountHealthSettings } from '../settings/service'
import { BaiduClient } from './client'
import { hasRequiredBaiduCookieFields, normalizeBaiduCookie } from './cookie'
import { renewOpenPlatformToken } from './openPlatform'

const client = new BaiduClient()

export type DisabledSource =
  | 'admin'
  | 'owner'
  | 'health_cookie_invalid'
  | 'health_not_svip'
  | 'health_low_space'
  | 'health_bdstoken_invalid'
  | 'health_transient_failure'
  | 'open_platform_reimport_required'
  | 'risk_control'
  | 'delete_needs_verify'

export type AccountProbeStatus = 'healthy' | 'failed' | 'transient_failed'

export type AccountProbeResult = {
  status: AccountProbeStatus
  code: string
  message: string
  deterministic: boolean
  disabledSource?: DisabledSource
  loginValid?: boolean | null
  bdstokenValid?: boolean | null
  isSvip?: boolean | null
  uk?: string
  baiduName?: string
  vipType?: string
  vipLeftSeconds?: number | null
  vipExpiresAt?: Date | null
  quotaTotalBytes?: number | null
  quotaUsedBytes?: number | null
  quotaFreeBytes?: number | null
  durationMs: number
  consecutiveFailures?: number
  accessToken?: string
  refreshToken?: string
  tokenExpiresAt?: Date | null
}

export const classifyProbeError = (error: unknown): Pick<AccountProbeResult, 'status' | 'code' | 'message' | 'deterministic' | 'disabledSource'> => {
  const code = error instanceof AppError ? error.code : 'HEALTH_UNKNOWN_ERROR'
  const message = error instanceof Error ? error.message : String(error)
  const text = `${code} ${message}`.toLowerCase()

  if (
    text.includes('cookie_invalid') ||
    text.includes('invalid bduss') ||
    text.includes('bduss 无效') ||
    text.includes('cookie 无效') ||
    text.includes('未登录') ||
    text.includes('cookie 格式异常') ||
    text.includes('cookie 被拒绝') ||
    text.includes('errno -6')
  ) {
    return {
      status: 'failed',
      code: 'HEALTH_COOKIE_INVALID',
      message: 'Cookie 无效或登录态失效',
      deterministic: true,
      disabledSource: 'health_cookie_invalid',
    }
  }

  if (text.includes('bdstoken')) {
    return {
      status: 'failed',
      code: 'HEALTH_BDSTOKEN_INVALID',
      message,
      deterministic: true,
      disabledSource: 'health_bdstoken_invalid',
    }
  }

  return {
    status: 'transient_failed',
    code,
    message,
    deterministic: false,
  }
}

export const membershipExpiryFromResponse = (membership: {
  currenttime?: number
  reminder?: {
    serverTime?: number
    svip?: { leftseconds?: number }
    vip?: { leftseconds?: number }
  }
}) => {
  const leftSeconds = Number(membership.reminder?.svip?.leftseconds ?? membership.reminder?.vip?.leftseconds ?? 0)
  if (!Number.isFinite(leftSeconds) || leftSeconds <= 0) {
    return { vipLeftSeconds: null, vipExpiresAt: null }
  }

  const baseTimeSeconds = Number(membership.reminder?.serverTime ?? membership.currenttime ?? Math.floor(Date.now() / 1000))
  const safeBaseTimeSeconds = Number.isFinite(baseTimeSeconds) && baseTimeSeconds > 0 ? baseTimeSeconds : Math.floor(Date.now() / 1000)
  return {
    vipLeftSeconds: Math.floor(leftSeconds),
    vipExpiresAt: new Date((safeBaseTimeSeconds + Math.floor(leftSeconds)) * 1000),
  }
}

export const probeBaiduAccountCookie = async (cookie: string): Promise<AccountProbeResult> => {
  const normalizedCookie = normalizeBaiduCookie(cookie.trim())
  if (!hasRequiredBaiduCookieFields(normalizedCookie)) throw badRequest('BAD_COOKIE', 'Cookie 至少需要包含 BDUSS')

  const started = Date.now()
  try {
    const template = await client.getAccountTemplate(normalizedCookie)
    const loginValid = template.result?.loginstate === 1
    const bdstokenValid = Boolean(template.result?.bdstoken)
    if (!loginValid) {
      return {
        status: 'failed',
        code: 'HEALTH_COOKIE_INVALID',
        message: 'Cookie 无效或登录态失效',
        deterministic: true,
        disabledSource: 'health_cookie_invalid',
        loginValid,
        bdstokenValid,
        durationMs: Date.now() - started,
      }
    }
    const [uinfo, quota] = await Promise.all([client.getAccountUInfo(normalizedCookie), client.getQuota(normalizedCookie)])
    const uk = String(uinfo.uk ?? '')
    const isSvip = template.result?.is_svip === 1 || template.result?.is_evip === 1 || uinfo.vip_type === 2
    const vipType = isSvip ? 'svip' : template.result?.is_vip === 1 || uinfo.vip_type === 1 ? 'vip' : 'normal'
    const common = {
      loginValid,
      bdstokenValid,
      isSvip,
      uk,
      baiduName: uinfo.baidu_name ?? template.result?.username ?? '',
      vipType,
      quotaTotalBytes: quota.total,
      quotaUsedBytes: quota.used,
      quotaFreeBytes: quota.free,
      durationMs: Date.now() - started,
    }

    if (!bdstokenValid) {
      return {
        ...common,
        status: 'failed',
        code: 'HEALTH_BDSTOKEN_INVALID',
        message: 'bdstoken 缺失，账号无法执行需要网页令牌的操作',
        deterministic: true,
        disabledSource: 'health_bdstoken_invalid',
      }
    }

    if (!uk) {
      return {
        ...common,
        status: 'failed',
        code: 'HEALTH_UK_MISSING',
        message: '未能识别百度账号 uk',
        deterministic: true,
        disabledSource: 'health_cookie_invalid',
      }
    }
    if (!isSvip) {
      return {
        ...common,
        status: 'failed',
        code: 'HEALTH_NOT_SVIP',
        message: '账号不是 SVIP，不能用于本地解析',
        deterministic: true,
        disabledSource: 'health_not_svip',
      }
    }
    if (quota.free < getAccountHealthSettings().accountHealthLowSpaceBytes) {
      return {
        ...common,
        status: 'failed',
        code: 'HEALTH_LOW_SPACE',
        message: `账号剩余空间低于阈值，剩余 ${quota.free} bytes`,
        deterministic: true,
        disabledSource: 'health_low_space',
      }
    }

    return {
      ...common,
      status: 'healthy',
      code: 'OK',
      message: '账号健康检测通过',
      deterministic: true,
    }
  } catch (error) {
    return {
      ...classifyProbeError(error),
      durationMs: Date.now() - started,
    }
  }
}

export const probeBaiduOpenPlatform = async (
  refreshToken: string,
  options?: {
    accessTokenOverride?: string
    skipRefresh?: boolean
    clientKey?: string | null
    secretKey?: string | null
    serverUse?: boolean | null
  },
): Promise<AccountProbeResult> => {
  const normalizedRefreshToken = refreshToken.trim()
  const accessTokenOverride = options?.accessTokenOverride?.trim() ?? ''
  if (!normalizedRefreshToken && !accessTokenOverride) throw badRequest('BAD_REFRESH_TOKEN', 'refresh_token 不能为空')

  const started = Date.now()
  try {
    const token = accessTokenOverride
      ? {
          accessToken: accessTokenOverride,
          refreshToken: normalizedRefreshToken,
          expiresIn: 0,
          tokenExpiresAt: null,
        }
      : options?.skipRefresh
        ? {
            accessToken: '',
            refreshToken: normalizedRefreshToken,
            expiresIn: 0,
            tokenExpiresAt: null,
          }
        : await renewOpenPlatformToken(normalizedRefreshToken, {
            clientKey: options?.clientKey,
            secretKey: options?.secretKey,
            serverUse: options?.serverUse,
          })
    const accessToken = accessTokenOverride || token.accessToken
    if (!accessToken) throw badRequest('OPEN_PLATFORM_ACCESS_TOKEN_MISSING', '开放平台账号缺少 access_token')
    const [uinfo, quota, membership] = await Promise.all([
      client.getAccountUInfoByAccessToken(accessToken),
      client.getQuotaByAccessToken(accessToken),
      client.getMembershipByAccessToken(accessToken),
    ])

    const detailCluster = membership.current_product_v2?.detail_cluster
    const isSvip = detailCluster === 'svip' || Number(uinfo.vip_type ?? 0) === 2
    const vipType = isSvip ? 'svip' : Number(uinfo.vip_type ?? 0) === 1 ? 'vip' : 'normal'
    const membershipExpiry = membershipExpiryFromResponse(membership)
    const uk = String(uinfo.uk ?? '')
    const common = {
      loginValid: true,
      bdstokenValid: true,
      isSvip,
      uk,
      baiduName: uinfo.baidu_name ?? uinfo.netdisk_name ?? '',
      vipType,
      vipLeftSeconds: membershipExpiry.vipLeftSeconds,
      vipExpiresAt: membershipExpiry.vipExpiresAt,
      quotaTotalBytes: quota.total,
      quotaUsedBytes: quota.used,
      quotaFreeBytes: quota.free,
      durationMs: Date.now() - started,
      accessToken,
      refreshToken: token.refreshToken,
      tokenExpiresAt: token.tokenExpiresAt,
    }

    if (!uk) {
      return {
        ...common,
        status: 'failed',
        code: 'HEALTH_UK_MISSING',
        message: '未能识别百度账号 uk',
        deterministic: true,
        disabledSource: 'health_cookie_invalid',
      }
    }

    if (!isSvip) {
      return {
        ...common,
        status: 'failed',
        code: 'HEALTH_NOT_SVIP',
        message: '账号不是 SVIP，不能用于本地解析',
        deterministic: true,
        disabledSource: 'health_not_svip',
      }
    }

    if (quota.free < getAccountHealthSettings().accountHealthLowSpaceBytes) {
      return {
        ...common,
        status: 'failed',
        code: 'HEALTH_LOW_SPACE',
        message: `账号剩余空间低于阈值，剩余 ${quota.free} bytes`,
        deterministic: true,
        disabledSource: 'health_low_space',
      }
    }

    return {
      ...common,
      status: 'healthy',
      code: 'OK',
      message: '开放平台账号健康检测通过',
      deterministic: true,
    }
  } catch (error) {
    const classified = classifyProbeError(error)
    return {
      ...classified,
      loginValid: null,
      bdstokenValid: true,
      isSvip: null,
      durationMs: Date.now() - started,
      tokenExpiresAt: null,
    }
  }
}

const boolValue = (value?: boolean | null) => (value === undefined ? null : value)

export const recordAccountHealthCheck = (
  accountId: number,
  result: AccountProbeResult | (Omit<AccountProbeResult, 'status'> & { status: 'skipped_locked' }),
) => {
  db.insert(accountHealthChecks)
    .values({
      accountId,
      status: result.status,
      code: result.code,
      message: result.message.slice(0, 500),
      deterministic: result.deterministic,
      loginValid: boolValue(result.loginValid),
      bdstokenValid: boolValue(result.bdstokenValid),
      isSvip: boolValue(result.isSvip),
      vipLeftSeconds: result.vipLeftSeconds ?? null,
      vipExpiresAt: result.vipExpiresAt ?? null,
      quotaTotalBytes: result.quotaTotalBytes ?? null,
      quotaUsedBytes: result.quotaUsedBytes ?? null,
      quotaFreeBytes: result.quotaFreeBytes ?? null,
      durationMs: result.durationMs,
      createdAt: new Date(),
    })
    .run()
}
