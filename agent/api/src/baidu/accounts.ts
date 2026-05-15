import { and, asc, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import { db, sqlite } from '../db'
import { accountHealthChecks, accountStatusEvents, accountTokenEvents, baiduAccounts, parseAttempts, parseRecords, type BaiduAccount, type User } from '../db/schema'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors'
import { getAccountPolicy } from '../settings/service'
import { probeBaiduAccountCookie, probeBaiduOpenPlatform, recordAccountHealthCheck, type AccountProbeResult } from './accountProbe'
import { BaiduClient } from './client'
import { hasRequiredBaiduCookieFields, normalizeBaiduCookie } from './cookie'
import type { CredentialSource } from './types'

const client = new BaiduClient()

type AccountFailureClass = 'expired' | 'limited' | 'cooldown' | 'network' | 'unknown'
type AccountStatus = 'active' | 'disabled' | 'cooldown'
type OpenPlatformCredentialInput = {
  openPlatformClientKey?: string
  openPlatformSecretKey?: string
  openPlatformServerUse?: boolean
}

const normalizeOpenPlatformCredential = (input: OpenPlatformCredentialInput) => {
  const serverUse = input.openPlatformServerUse === true
  const clientKey = serverUse ? '' : input.openPlatformClientKey?.trim() ?? ''
  const secretKey = serverUse ? '' : input.openPlatformSecretKey?.trim() ?? ''

  if (!serverUse && (!clientKey || !secretKey)) {
    throw badRequest('OPEN_PLATFORM_CLIENT_CREDENTIALS_REQUIRED', '开放平台 AK/SK 不能为空')
  }

  return {
    driver: 'baiduyun_go',
    clientKey,
    secretKey,
    serverUse,
  }
}

export const isFileLevelFailure = (code: string, message: string) => {
  const text = `${code} ${message}`.toLowerCase()
  return (
    text.includes('shared_download_unsupported') ||
    text.includes('非直链格式') ||
    text.includes('sharedownload 路线不支持') ||
    text.includes('文件过大') ||
    text.includes('too large') ||
    text.includes('需要先保存到网盘') ||
    text.includes('需要保存到网盘')
  )
}

const classifyFailure = (code: string, message: string): AccountFailureClass => {
  const text = `${code} ${message}`.toLowerCase()
  if (isFileLevelFailure(code, message)) return 'unknown'
  if (
    text.includes('cookie_invalid') ||
    text.includes('invalid bduss') ||
    text.includes('bduss 无效') ||
    text.includes('cookie 无效') ||
    text.includes('未登录') ||
    text.includes('8001') ||
    text.includes('-6')
  ) return 'expired'
  if (
    text.includes('限速') ||
    text.includes('tsl=1') ||
    text.includes('qdall01')
  ) return 'limited'
  if (
    text.includes('baidu_page_expired') ||
    text.includes('baidu_cookie_or_account_restricted') ||
    text.includes('baidu_captcha_or_risk_control') ||
    text.includes('baidu_access_token_expired') ||
    text.includes('save_to_disk_failed') ||
    text.includes('空间') ||
    text.includes('quota') ||
    text.includes('容量') ||
    text.includes('9019') ||
    text.includes('112') ||
    text.includes('风控') ||
    text.includes('captcha') ||
    text.includes('-20') ||
    text.includes('验证码')
  ) return 'cooldown'
  if (
    text.includes('baidu_timeout') ||
    text.includes('baidu_http_failed') ||
    text.includes('baidu_head_failed') ||
    text.includes('timeout') ||
    text.includes('network') ||
    text.includes('http') ||
    text.includes('fetch failed') ||
    text.includes('econn')
  ) return 'network'
  return 'unknown'
}

export const recordAccountStatusEvent = (params: {
  accountId: number
  oldStatus?: string | null
  newStatus: string
  oldReason?: string | null
  newReason?: string | null
  source: string
  code?: string | null
  message: string
  actorUserId?: number | null
  parseJobId?: number | null
  parseRecordId?: number | null
}) => {
  db.insert(accountStatusEvents).values({
    accountId: params.accountId,
    oldStatus: params.oldStatus ?? null,
    newStatus: params.newStatus,
    oldReason: params.oldReason ?? null,
    newReason: params.newReason ?? null,
    source: params.source,
    code: params.code ?? null,
    message: params.message,
    actorUserId: params.actorUserId ?? null,
    parseJobId: params.parseJobId ?? null,
    parseRecordId: params.parseRecordId ?? null,
  }).run()
}

const tryLockAccount = (accountId: number) => {
  const now = new Date()
  const lockedUntil = new Date(Date.now() + getAccountPolicy().accountLockSeconds * 1000)
  db.update(baiduAccounts)
    .set({
      lockedUntil,
      updatedAt: now,
    })
    .where(and(
      eq(baiduAccounts.id, accountId),
      eq(baiduAccounts.status, 'active'),
      or(isNull(baiduAccounts.lockedUntil), lt(baiduAccounts.lockedUntil, now)),
      or(isNull(baiduAccounts.cooldownUntil), lt(baiduAccounts.cooldownUntil, now)),
    ))
    .run()
  const locked = db.select().from(baiduAccounts).where(eq(baiduAccounts.id, accountId)).get()
  return Boolean(locked?.lockedUntil && locked.lockedUntil.getTime() === lockedUntil.getTime())
}

export const releaseAccount = (accountId: number) => {
  db.update(baiduAccounts)
    .set({ lockedUntil: null, updatedAt: new Date() })
    .where(eq(baiduAccounts.id, accountId))
    .run()
}

export const markAccountSuccess = (accountId: number, context?: { parseJobId?: number | null, parseRecordId?: number | null }) => {
  const before = db.select().from(baiduAccounts).where(eq(baiduAccounts.id, accountId)).get()
  db.update(baiduAccounts).set({
    lockedUntil: null,
    cooldownUntil: null,
    status: 'active',
    reason: '',
    lastUsedAt: new Date(),
    lastSuccessAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(baiduAccounts.id, accountId)).run()
  if (before && (before.status !== 'active' || before.reason || before.lastFailureCode || before.cooldownUntil)) {
    recordAccountStatusEvent({
      accountId,
      oldStatus: before.status,
      newStatus: 'active',
      oldReason: before.reason,
      newReason: '',
      source: 'auto_success',
      code: before.lastFailureCode,
      message: '账号成功解析，自动恢复为可用',
      parseJobId: context?.parseJobId,
      parseRecordId: context?.parseRecordId,
    })
  }
}

export const markAccountFailure = (accountId: number, code: string, message: string, context?: { parseJobId?: number | null, parseRecordId?: number | null }) => {
  const before = db.select().from(baiduAccounts).where(eq(baiduAccounts.id, accountId)).get()
  const failure = classifyFailure(code, message)
  const update: Partial<typeof baiduAccounts.$inferInsert> = {
    lockedUntil: null,
    lastUsedAt: new Date(),
    lastFailureAt: new Date(),
    lastFailureCode: code,
    reason: message.slice(0, 300),
    updatedAt: new Date(),
  }

  if (failure === 'expired') {
    update.status = 'disabled'
    update.disabledSource = 'risk_control'
  } else if (failure === 'limited' || failure === 'cooldown') {
    update.status = 'cooldown'
    update.disabledSource = null
    update.cooldownUntil = new Date(Date.now() + getAccountPolicy().accountCooldownSeconds * 1000)
  }

  db.update(baiduAccounts).set(update).where(eq(baiduAccounts.id, accountId)).run()
  const nextStatus = update.status ?? before?.status ?? 'active'
  if (before && update.status && (before.status !== update.status || before.reason !== update.reason)) {
    recordAccountStatusEvent({
      accountId,
      oldStatus: before.status,
      newStatus: nextStatus,
      oldReason: before.reason,
      newReason: update.reason ?? '',
      source: 'auto_failure',
      code,
      message,
      parseJobId: context?.parseJobId,
      parseRecordId: context?.parseRecordId,
    })
  }
}

export const acquireLocalAccount = (ownerUserId: number) => {
  const now = new Date()
  const accounts = db.select().from(baiduAccounts)
    .where(and(
      eq(baiduAccounts.ownerUserId, ownerUserId),
      eq(baiduAccounts.status, 'active'),
      or(isNull(baiduAccounts.cooldownUntil), lt(baiduAccounts.cooldownUntil, now)),
    ))
    .orderBy(desc(baiduAccounts.weight), asc(baiduAccounts.id))
    .all()
    .sort((left, right) => (Math.random() * Math.max(1, right.weight)) - (Math.random() * Math.max(1, left.weight)))

  for (const account of accounts) {
    if (tryLockAccount(account.id)) {
      return db.select().from(baiduAccounts).where(eq(baiduAccounts.id, account.id)).get()
    }
  }
  return null
}

export const hasLocalAccountCandidate = (ownerUserId: number) => {
  const now = new Date()
  const row = db.select({ value: sql<number>`COUNT(*)` }).from(baiduAccounts)
    .where(and(
      eq(baiduAccounts.ownerUserId, ownerUserId),
      eq(baiduAccounts.status, 'active'),
      or(isNull(baiduAccounts.cooldownUntil), lt(baiduAccounts.cooldownUntil, now)),
    ))
    .get()
  return Number(row?.value ?? 0) > 0
}

export const acquireAccountById = (accountId: number) => {
  const now = new Date()
  const lockedUntil = new Date(Date.now() + getAccountPolicy().accountLockSeconds * 1000)
  db.update(baiduAccounts)
    .set({
      lockedUntil,
      updatedAt: now,
    })
    .where(and(
      eq(baiduAccounts.id, accountId),
      sql`${baiduAccounts.status} != 'disabled'`,
      or(isNull(baiduAccounts.lockedUntil), lt(baiduAccounts.lockedUntil, now)),
    ))
    .run()
  const locked = db.select().from(baiduAccounts).where(eq(baiduAccounts.id, accountId)).get()
  return locked?.lockedUntil?.getTime() === lockedUntil.getTime() ? locked : null
}

export const listAccounts = () => db.select().from(baiduAccounts).orderBy(sql`${baiduAccounts.id} DESC`).all()

const assertAccountOwner = (accountId: number, owner: User) => {
  const account = db.select().from(baiduAccounts).where(eq(baiduAccounts.id, accountId)).get()
  if (!account) throw notFound('ACCOUNT_NOT_FOUND', '账号不存在')
  if (account.ownerUserId !== owner.id) throw forbidden('ACCOUNT_FORBIDDEN', '无权操作该账号')
  return account
}

export const addAccount = async (input: {
  label?: string
  cookie?: string
  refreshToken?: string
  openPlatformClientKey?: string
  openPlatformSecretKey?: string
  openPlatformServerUse?: boolean
  weight?: number
  actor: User
  ownerUserId?: number
  credentialSource?: CredentialSource
  strictHealthy?: boolean
}) => {
  const credentialSource = input.credentialSource ?? 'cookie'
  const cookie = credentialSource === 'cookie' ? normalizeBaiduCookie(input.cookie?.trim() ?? '') : ''
  const refreshToken = input.refreshToken?.trim() ?? ''
  const ownerUserId = input.ownerUserId ?? input.actor.id
  const openPlatformCredential = credentialSource === 'open_platform'
    ? normalizeOpenPlatformCredential(input)
    : null

  if (credentialSource === 'cookie') {
    if (!hasRequiredBaiduCookieFields(cookie)) throw badRequest('BAD_COOKIE', 'Cookie 至少需要包含 BDUSS')
  } else if (!refreshToken) {
    throw badRequest('BAD_REFRESH_TOKEN', 'refresh_token 不能为空')
  }

  const health = credentialSource === 'open_platform'
    ? await probeBaiduOpenPlatform(refreshToken, openPlatformCredential ?? undefined)
    : await probeBaiduAccountCookie(cookie)
  const existing = health.uk ? db.select().from(baiduAccounts).where(eq(baiduAccounts.uk, health.uk)).get() : undefined
  if (health.status !== 'healthy' && (input.strictHealthy || !existing)) throw badRequest(health.code, health.message, health)

  const label = input.label?.trim() || health.baiduName || 'SVIP账号'
  const weight = Math.max(1, Math.floor(input.weight ?? 100))
  if (existing) {
    if (existing.ownerUserId !== null && existing.ownerUserId !== ownerUserId) {
      throw conflict('ACCOUNT_ALREADY_BOUND', `该百度账号已被用户 #${existing.ownerUserId} 绑定`)
    }
    const isHealthy = health.status === 'healthy'
    db.update(baiduAccounts).set({
      label,
      ownerUserId,
      cookie: credentialSource === 'cookie' ? cookie : existing.cookie,
      credentialSource,
      refreshToken: credentialSource === 'open_platform' ? (health.refreshToken ?? refreshToken) : null,
      accessToken: credentialSource === 'open_platform' ? (health.accessToken ?? null) : null,
      tokenExpiresAt: credentialSource === 'open_platform' ? (health.tokenExpiresAt ?? null) : null,
      openPlatformDriver: credentialSource === 'open_platform' ? openPlatformCredential?.driver : null,
      openPlatformClientKey: credentialSource === 'open_platform' && !openPlatformCredential?.serverUse ? openPlatformCredential?.clientKey : null,
      openPlatformSecretKey: credentialSource === 'open_platform' && !openPlatformCredential?.serverUse ? openPlatformCredential?.secretKey : null,
      openPlatformServerUse: credentialSource === 'open_platform' ? openPlatformCredential?.serverUse : null,
      weight,
      baiduName: health.baiduName ?? existing.baiduName,
      vipType: health.vipType ?? existing.vipType,
      status: isHealthy ? 'active' : 'disabled',
      reason: isHealthy ? '' : health.message.slice(0, 300),
      disabledSource: isHealthy ? null : health.disabledSource ?? 'health_transient_failure',
      healthStatus: health.status,
      healthMessage: health.message.slice(0, 300),
      healthCheckedAt: new Date(),
      loginValid: health.loginValid ?? null,
      bdstokenValid: health.bdstokenValid ?? null,
      isSvip: health.isSvip ?? null,
      quotaTotalBytes: health.quotaTotalBytes ?? null,
      quotaUsedBytes: health.quotaUsedBytes ?? null,
      quotaFreeBytes: health.quotaFreeBytes ?? null,
      healthConsecutiveFailures: isHealthy || health.deterministic ? 0 : (existing.healthConsecutiveFailures ?? 0) + 1,
      healthLastErrorCode: isHealthy ? null : health.code,
      tokenStatus: credentialSource === 'open_platform' ? (isHealthy ? 'valid' : 'unknown') : existing.tokenStatus,
      tokenCheckedAt: credentialSource === 'open_platform' ? new Date() : existing.tokenCheckedAt,
      tokenMessage: credentialSource === 'open_platform' ? health.message.slice(0, 300) : existing.tokenMessage,
      tokenLastErrorCode: credentialSource === 'open_platform' ? (isHealthy ? null : health.code) : existing.tokenLastErrorCode,
      tokenLastRefreshedAt: credentialSource === 'open_platform' && isHealthy ? new Date() : existing.tokenLastRefreshedAt,
      lockedUntil: null,
      cooldownUntil: null,
      lastFailureAt: isHealthy ? existing.lastFailureAt : new Date(),
      lastFailureCode: isHealthy ? null : health.code,
      updatedAt: new Date(),
    }).where(eq(baiduAccounts.id, existing.id)).run()
    recordAccountStatusEvent({
      accountId: existing.id,
      oldStatus: existing.status,
      newStatus: isHealthy ? 'active' : 'disabled',
      oldReason: existing.reason,
      newReason: isHealthy ? '' : health.message.slice(0, 300),
      source: 'admin_upsert',
      actorUserId: input.actor.id,
      code: isHealthy ? existing.lastFailureCode : health.code,
      message: isHealthy ? '重复添加账号，已更新 Cookie 并重置状态' : '重复添加账号，新 Cookie 健康检测失败，已覆盖并禁用账号',
    })
    recordAccountHealthCheck(existing.id, health)
    const account = db.select().from(baiduAccounts).where(eq(baiduAccounts.id, existing.id)).get()
    return { account, created: false, updated: true, disabledByHealth: !isHealthy, health }
  }

  db.insert(baiduAccounts).values({
    label,
    cookie: credentialSource === 'cookie' ? cookie : '',
    ownerUserId,
    credentialSource,
    refreshToken: credentialSource === 'open_platform' ? (health.refreshToken ?? refreshToken) : null,
    accessToken: credentialSource === 'open_platform' ? (health.accessToken ?? null) : null,
    tokenExpiresAt: credentialSource === 'open_platform' ? (health.tokenExpiresAt ?? null) : null,
    openPlatformDriver: credentialSource === 'open_platform' ? openPlatformCredential?.driver : null,
    openPlatformClientKey: credentialSource === 'open_platform' && !openPlatformCredential?.serverUse ? openPlatformCredential?.clientKey : null,
    openPlatformSecretKey: credentialSource === 'open_platform' && !openPlatformCredential?.serverUse ? openPlatformCredential?.secretKey : null,
    openPlatformServerUse: credentialSource === 'open_platform' ? openPlatformCredential?.serverUse : null,
    weight,
    uk: health.uk,
    baiduName: health.baiduName,
    vipType: health.vipType ?? 'unknown',
    status: 'active',
    disabledSource: null,
    healthStatus: 'healthy',
    healthMessage: health.message,
    healthCheckedAt: new Date(),
    loginValid: health.loginValid ?? null,
    bdstokenValid: health.bdstokenValid ?? null,
    isSvip: health.isSvip ?? null,
    quotaTotalBytes: health.quotaTotalBytes ?? null,
    quotaUsedBytes: health.quotaUsedBytes ?? null,
    quotaFreeBytes: health.quotaFreeBytes ?? null,
    healthConsecutiveFailures: 0,
    healthLastErrorCode: null,
    tokenStatus: credentialSource === 'open_platform' ? 'valid' : 'unknown',
    tokenCheckedAt: credentialSource === 'open_platform' ? new Date() : null,
    tokenMessage: credentialSource === 'open_platform' ? health.message : null,
    tokenLastErrorCode: null,
    tokenLastRefreshedAt: credentialSource === 'open_platform' ? new Date() : null,
    createdByUserId: input.actor.id,
  }).run()
  const account = db.select().from(baiduAccounts).where(eq(baiduAccounts.uk, health.uk ?? '')).get()
  if (account) {
    recordAccountHealthCheck(account.id, health)
    recordAccountStatusEvent({
      accountId: account.id,
      oldStatus: null,
      newStatus: 'active',
      oldReason: null,
      newReason: '',
      source: 'admin_create',
      actorUserId: input.actor.id,
      message: '新增账号',
    })
  }

  return { account, created: true, updated: false, disabledByHealth: false, health }
}

export const probeAccountForAdd = async (input: {
  credentialSource?: CredentialSource
  cookie?: string
  refreshToken?: string
  openPlatformClientKey?: string
  openPlatformSecretKey?: string
  openPlatformServerUse?: boolean
}) => {
  const credentialSource = input.credentialSource ?? 'cookie'
  const openPlatformCredential = credentialSource === 'open_platform'
    ? normalizeOpenPlatformCredential(input)
    : null
  const health = credentialSource === 'open_platform'
    ? await probeBaiduOpenPlatform(String(input.refreshToken ?? ''), openPlatformCredential ?? undefined)
    : await probeBaiduAccountCookie(normalizeBaiduCookie(String(input.cookie ?? '')))
  if (health.status !== 'healthy') throw badRequest(health.code, health.message, health)
  const existing = health.uk ? db.select().from(baiduAccounts).where(eq(baiduAccounts.uk, health.uk)).get() : undefined
  return {
    credentialSource,
    health,
    existingAccountId: existing?.id ?? null,
    exists: Boolean(existing),
    action: existing ? 'update' : 'create',
  } satisfies {
    credentialSource: CredentialSource
    health: AccountProbeResult
    existingAccountId: number | null
    exists: boolean
    action: 'create' | 'update'
  }
}

type TemplateResponse = {
  errno?: number
  result?: {
    username?: string
    loginstate?: number
    is_vip?: number
    is_svip?: number
    is_evip?: number
  }
}

type UInfoResponse = {
  errno?: number
  uk?: number | string
  baidu_name?: string
  vip_type?: number
  errmsg?: string
}

export const validateCookie = async (cookie: string) => {
  const template = await fetch('https://pan.baidu.com/api/gettemplatevariable?channel=chunlei&web=1&app_id=250528&clienttype=0', {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'fields=[%22username%22,%22loginstate%22,%22is_vip%22,%22is_svip%22,%22is_evip%22]',
  }).then((res) => res.json() as Promise<TemplateResponse>)

  if (template.errno !== 0 || template.result?.loginstate !== 1) {
    throw badRequest('COOKIE_INVALID', 'Cookie 无效或未登录', template)
  }

  const uinfo = await fetch('https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Cookie: cookie,
    },
  }).then((res) => res.json() as Promise<UInfoResponse>)

  if (uinfo.errmsg === 'Invalid Bduss') throw badRequest('COOKIE_INVALID', 'BDUSS 无效', uinfo)

  const isSvip = template.result.is_svip === 1 || template.result.is_evip === 1 || uinfo.vip_type === 2
  return {
    uk: String(uinfo.uk ?? ''),
    baiduName: uinfo.baidu_name ?? template.result.username ?? '',
    vipType: isSvip ? 'svip' : template.result.is_vip === 1 || uinfo.vip_type === 1 ? 'vip' : 'normal',
  }
}

export const setAccountStatus = (id: number, status: AccountStatus, reason = '', actor?: User) => {
  const before = db.select().from(baiduAccounts).where(eq(baiduAccounts.id, id)).get()
  db.update(baiduAccounts).set({
    status,
    reason,
    disabledSource: status === 'disabled' ? 'admin' : null,
    cooldownUntil: status === 'cooldown' ? new Date(Date.now() + getAccountPolicy().accountCooldownSeconds * 1000) : null,
    lockedUntil: null,
    updatedAt: new Date(),
  }).where(eq(baiduAccounts.id, id)).run()
  if (before) {
    recordAccountStatusEvent({
      accountId: id,
      oldStatus: before.status,
      newStatus: status,
      oldReason: before.reason,
      newReason: reason,
      source: 'admin_status',
      actorUserId: actor?.id,
      message: `管理员将账号状态改为 ${status}`,
    })
  }
}

export const setAccountOwnerStatus = (id: number, status: AccountStatus, reason = '', actor?: User) => {
  const before = db.select().from(baiduAccounts).where(eq(baiduAccounts.id, id)).get()
  db.update(baiduAccounts).set({
    status,
    reason,
    disabledSource: status === 'disabled' ? 'owner' : null,
    cooldownUntil: status === 'cooldown' ? new Date(Date.now() + getAccountPolicy().accountCooldownSeconds * 1000) : null,
    lockedUntil: null,
    updatedAt: new Date(),
  }).where(eq(baiduAccounts.id, id)).run()
  if (before) {
    recordAccountStatusEvent({
      accountId: id,
      oldStatus: before.status,
      newStatus: status,
      oldReason: before.reason,
      newReason: reason,
      source: 'owner_status',
      actorUserId: actor?.id,
      message: `账号所有者将账号状态改为 ${status}`,
    })
  }
}

export const testAccountSign = async (account: BaiduAccount, shareid: number, uk: number) =>
  client.getSign({ shareid, uk, cookie: account.cookie })

export const listOwnedAccounts = (owner: User) => {
  const items = db.select().from(baiduAccounts)
    .where(eq(baiduAccounts.ownerUserId, owner.id))
    .orderBy(sql`${baiduAccounts.id} DESC`)
    .all()
    .map((account) => {
      const [usage] = db.select({
        totalParses: sql<number>`COUNT(*)`,
      }).from(parseRecords)
        .where(eq(parseRecords.accountId, account.id))
        .all()
      return {
        ...account,
        usage: {
          totalParses: Number(usage?.totalParses ?? 0),
        },
      }
    })
  return items
}

export const createOwnedAccount = async (input: {
  label?: string
  cookie?: string
  refreshToken?: string
  openPlatformClientKey?: string
  openPlatformSecretKey?: string
  openPlatformServerUse?: boolean
  weight?: number
  credentialSource?: CredentialSource
  owner: User
}) => {
  return addAccount({
    label: input.label,
    cookie: input.cookie,
    refreshToken: input.refreshToken,
    openPlatformClientKey: input.openPlatformClientKey,
    openPlatformSecretKey: input.openPlatformSecretKey,
    openPlatformServerUse: input.openPlatformServerUse,
    weight: input.weight,
    actor: input.owner,
    ownerUserId: input.owner.id,
    credentialSource: input.credentialSource,
  })
}

export const probeOwnedAccount = async (input: {
  credentialSource?: CredentialSource
  cookie?: string
  refreshToken?: string
  openPlatformClientKey?: string
  openPlatformSecretKey?: string
  openPlatformServerUse?: boolean
  owner: User
}) => {
  const result = await probeAccountForAdd({
    credentialSource: input.credentialSource,
    cookie: input.cookie,
    refreshToken: input.refreshToken,
    openPlatformClientKey: input.openPlatformClientKey,
    openPlatformSecretKey: input.openPlatformSecretKey,
    openPlatformServerUse: input.openPlatformServerUse,
  })
  if (result.existingAccountId) {
    const existing = db.select().from(baiduAccounts).where(eq(baiduAccounts.id, result.existingAccountId)).get()
    if (existing && existing.ownerUserId !== null && existing.ownerUserId !== input.owner.id) {
      throw conflict('ACCOUNT_ALREADY_BOUND', `该百度账号已被用户 #${existing.ownerUserId} 绑定`)
    }
  }
  return result
}

export const setOwnedAccountStatus = (accountId: number, status: AccountStatus, owner: User) => {
  assertAccountOwner(accountId, owner)
  setAccountOwnerStatus(accountId, status, status === 'active' ? '账号所有者启用' : '账号所有者暂停', owner)
  return db.select().from(baiduAccounts).where(eq(baiduAccounts.id, accountId)).get()
}

export const deleteOwnedAccount = (accountId: number, owner: User) => {
  const account = assertAccountOwner(accountId, owner)
  if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
    throw conflict('ACCOUNT_LOCKED', '账号当前正在执行任务，请稍后再试')
  }
  db.delete(baiduAccounts).where(eq(baiduAccounts.id, accountId)).run()
}

export const getOwnedAccountDetail = (accountId: number, owner: User) => {
  const account = assertAccountOwner(accountId, owner)
  const records = db.select().from(parseRecords)
    .where(eq(parseRecords.accountId, accountId))
    .orderBy(sql`${parseRecords.id} DESC`)
    .limit(20)
    .all()
  const attempts = db.select().from(parseAttempts)
    .where(eq(parseAttempts.accountId, accountId))
    .orderBy(sql`${parseAttempts.id} DESC`)
    .limit(20)
    .all()
  const healthChecks = db.select().from(accountHealthChecks)
    .where(eq(accountHealthChecks.accountId, accountId))
    .orderBy(sql`${accountHealthChecks.id} DESC`)
    .limit(20)
    .all()
  const tokenEvents = db.select().from(accountTokenEvents)
    .where(eq(accountTokenEvents.accountId, accountId))
    .orderBy(sql`${accountTokenEvents.id} DESC`)
    .limit(20)
    .all()
  return {
    account,
    records,
    attempts,
    healthChecks,
    tokenEvents,
  }
}
