import { desc, eq, lt, sql } from 'drizzle-orm'
import { db } from '../db'
import { accountTokenEvents, baiduAccounts, type BaiduAccount } from '../db/schema'
import { upstreamError } from '../lib/errors'
import { BaiduClient } from './client'
import { renewOpenPlatformToken } from './openPlatform'
import { recordAccountStatusEvent } from './accounts'

const client = new BaiduClient()
const TOKEN_EVENT_TTL_DAYS = 7

export type OpenPlatformTokenTrigger = 'health_check' | 'admin_token_check' | 'parse_runtime' | 'cleanup'
export type OpenPlatformTokenAction = 'validate' | 'refresh'
export type OpenPlatformTokenEventStatus = 'success' | 'refreshed' | 'failed'

export type OpenPlatformTokenCheckResult = {
  account: BaiduAccount
  accessToken: string
  action: 'validated' | 'refreshed'
  accessTokenUsable: boolean
  refreshAttempted: boolean
  requiresReimport: boolean
  message: string
  tokenCheckedAt: Date
  tokenLastRefreshedAt: Date | null
}

const appErrorInfo = (error: unknown) => {
  if (error && typeof error === 'object') {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : null
    const message = 'message' in error && typeof error.message === 'string' ? error.message : null
    if (code || message) return { code: code ?? 'UNKNOWN', message: message ?? code ?? '未知错误' }
  }
  const normalized = error instanceof Error ? error : new Error(String(error))
  const code = 'code' in normalized && typeof normalized.code === 'string' ? normalized.code : 'UNKNOWN'
  return { code, message: normalized.message }
}

const refreshAccount = (accountId: number) => db.select().from(baiduAccounts).where(eq(baiduAccounts.id, accountId)).get()

export const recordAccountTokenEvent = (input: {
  accountId: number
  parseJobId?: number | null
  trigger: OpenPlatformTokenTrigger
  action: OpenPlatformTokenAction
  status: OpenPlatformTokenEventStatus
  code?: string | null
  message: string
  accessTokenUsableBefore?: boolean | null
  accessTokenUsableAfter?: boolean | null
  tokenExpiresAt?: Date | null
}) => {
  db.insert(accountTokenEvents)
    .values({
      accountId: input.accountId,
      parseJobId: input.parseJobId ?? null,
      trigger: input.trigger,
      action: input.action,
      status: input.status,
      code: input.code ?? null,
      message: input.message,
      accessTokenUsableBefore: input.accessTokenUsableBefore ?? null,
      accessTokenUsableAfter: input.accessTokenUsableAfter ?? null,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
    })
    .run()
}

export const cleanupAccountTokenEvents = () => {
  const cutoff = new Date(Date.now() - TOKEN_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000)
  db.delete(accountTokenEvents).where(lt(accountTokenEvents.createdAt, cutoff)).run()
}

export const listAccountTokenEvents = (accountId: number, page: number, pageSize: number) => {
  const offset = (page - 1) * pageSize
  const items = db
    .select()
    .from(accountTokenEvents)
    .where(eq(accountTokenEvents.accountId, accountId))
    .orderBy(desc(accountTokenEvents.id))
    .limit(pageSize)
    .offset(offset)
    .all()
  const [total] = db.select({ value: sql<number>`COUNT(*)` }).from(accountTokenEvents).where(eq(accountTokenEvents.accountId, accountId)).all()
  return {
    items,
    page,
    pageSize,
    total: Number(total?.value ?? 0),
  }
}

const updateTokenSummary = (input: {
  accountId: number
  tokenStatus: 'valid' | 'refreshed' | 'invalid' | 'reimport_required' | 'unknown'
  tokenCheckedAt: Date
  tokenMessage: string
  tokenLastErrorCode?: string | null
  tokenLastRefreshedAt?: Date | null
  accessToken?: string | null
  refreshToken?: string | null
  tokenExpiresAt?: Date | null
}) => {
  db.update(baiduAccounts)
    .set({
      tokenStatus: input.tokenStatus,
      tokenCheckedAt: input.tokenCheckedAt,
      tokenMessage: input.tokenMessage.slice(0, 300),
      tokenLastErrorCode: input.tokenLastErrorCode ?? null,
      tokenLastRefreshedAt: input.tokenLastRefreshedAt ?? null,
      accessToken: input.accessToken === undefined ? undefined : input.accessToken,
      refreshToken: input.refreshToken === undefined ? undefined : input.refreshToken,
      tokenExpiresAt: input.tokenExpiresAt === undefined ? undefined : input.tokenExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(baiduAccounts.id, input.accountId))
    .run()
}

const markAccountReimportRequired = (account: BaiduAccount, code: string, message: string, tokenCheckedAt: Date) => {
  db.update(baiduAccounts)
    .set({
      status: 'disabled',
      reason: message.slice(0, 300),
      disabledSource: 'open_platform_reimport_required',
      lastFailureAt: new Date(),
      lastFailureCode: code,
      tokenStatus: 'reimport_required',
      tokenCheckedAt,
      tokenMessage: message.slice(0, 300),
      tokenLastErrorCode: code,
      updatedAt: new Date(),
    })
    .where(eq(baiduAccounts.id, account.id))
    .run()

  if (account.status !== 'disabled' || account.disabledSource !== 'open_platform_reimport_required' || account.reason !== message.slice(0, 300)) {
    recordAccountStatusEvent({
      accountId: account.id,
      oldStatus: account.status,
      newStatus: 'disabled',
      oldReason: account.reason,
      newReason: message.slice(0, 300),
      source: 'token_reimport_required',
      code,
      message,
    })
  }
}

const recoverAccountAfterTokenSuccess = (account: BaiduAccount) => {
  if (account.status === 'disabled' && account.disabledSource === 'open_platform_reimport_required') {
    db.update(baiduAccounts)
      .set({
        status: 'active',
        reason: '',
        disabledSource: null,
        cooldownUntil: null,
        lockedUntil: null,
        lastFailureCode: null,
        updatedAt: new Date(),
      })
      .where(eq(baiduAccounts.id, account.id))
      .run()
    recordAccountStatusEvent({
      accountId: account.id,
      oldStatus: account.status,
      newStatus: 'active',
      oldReason: account.reason,
      newReason: '',
      source: 'token_recover',
      code: 'OK',
      message: '开放平台 token 校验成功，账号恢复可用',
    })
  }
}

const validateAccessToken = async (accessToken: string) => {
  await Promise.all([
    client.getAccountUInfoByAccessToken(accessToken),
    client.getQuotaByAccessToken(accessToken),
    client.getMembershipByAccessToken(accessToken),
  ])
}

export const setOpenPlatformReimportRequired = (input: { accountId: number; code: string; message: string; tokenCheckedAt?: Date }) => {
  const account = refreshAccount(input.accountId)
  if (account) {
    markAccountReimportRequired(account, input.code, input.message, input.tokenCheckedAt ?? new Date())
  }
  updateTokenSummary({
    accountId: input.accountId,
    tokenStatus: 'reimport_required',
    tokenCheckedAt: input.tokenCheckedAt ?? new Date(),
    tokenMessage: input.message,
    tokenLastErrorCode: input.code,
  })
}

export const verifyOpenPlatformToken = async (
  account: BaiduAccount,
  options: {
    trigger: OpenPlatformTokenTrigger
    parseJobId?: number | null
    allowRefreshFallback?: boolean
  },
): Promise<OpenPlatformTokenCheckResult> => {
  const tokenCheckedAt = new Date()
  const allowRefreshFallback = options.allowRefreshFallback !== false
  const accessToken = account.accessToken?.trim() ?? ''
  const refreshToken = account.refreshToken?.trim() ?? ''

  if (accessToken) {
    try {
      await validateAccessToken(accessToken)
      updateTokenSummary({
        accountId: account.id,
        tokenStatus: 'valid',
        tokenCheckedAt,
        tokenMessage: 'access_token 校验通过',
        tokenLastErrorCode: null,
      })
      recordAccountTokenEvent({
        accountId: account.id,
        parseJobId: options.parseJobId,
        trigger: options.trigger,
        action: 'validate',
        status: 'success',
        code: 'OK',
        message: 'access_token 校验通过',
        accessTokenUsableBefore: true,
        accessTokenUsableAfter: true,
      })
      recoverAccountAfterTokenSuccess(refreshAccount(account.id) ?? account)
      return {
        account: refreshAccount(account.id) ?? account,
        accessToken,
        action: 'validated',
        accessTokenUsable: true,
        refreshAttempted: false,
        requiresReimport: false,
        message: 'access_token 校验通过',
        tokenCheckedAt,
        tokenLastRefreshedAt: account.tokenLastRefreshedAt ?? null,
      }
    } catch (error) {
      const info = appErrorInfo(error)
      if (info.code !== 'OPEN_PLATFORM_ACCESS_TOKEN_INVALID') {
        updateTokenSummary({
          accountId: account.id,
          tokenStatus: 'unknown',
          tokenCheckedAt,
          tokenMessage: info.message,
          tokenLastErrorCode: info.code,
        })
        throw error
      }
    }
  }

  if (!allowRefreshFallback || !refreshToken) {
    const message = 'access_token 已失效，且无法使用 refresh_token 恢复，请重新导入开放平台账号'
    markAccountReimportRequired(account, 'OPEN_PLATFORM_ACCESS_TOKEN_INVALID', message, tokenCheckedAt)
    recordAccountTokenEvent({
      accountId: account.id,
      parseJobId: options.parseJobId,
      trigger: options.trigger,
      action: 'validate',
      status: 'failed',
      code: 'OPEN_PLATFORM_ACCESS_TOKEN_INVALID',
      message,
      accessTokenUsableBefore: Boolean(accessToken),
      accessTokenUsableAfter: false,
    })
    throw upstreamError('OPEN_PLATFORM_REIMPORT_REQUIRED', message)
  }

  try {
    const renewed = await renewOpenPlatformToken(refreshToken, {
      clientKey: account.openPlatformClientKey,
      secretKey: account.openPlatformSecretKey,
      serverUse: account.openPlatformServerUse !== false,
    })
    updateTokenSummary({
      accountId: account.id,
      tokenStatus: 'refreshed',
      tokenCheckedAt,
      tokenMessage: 'access_token 已通过 refresh_token 恢复',
      tokenLastErrorCode: null,
      tokenLastRefreshedAt: tokenCheckedAt,
      accessToken: renewed.accessToken,
      refreshToken: renewed.refreshToken,
      tokenExpiresAt: renewed.tokenExpiresAt,
    })
    recordAccountTokenEvent({
      accountId: account.id,
      parseJobId: options.parseJobId,
      trigger: options.trigger,
      action: 'refresh',
      status: 'refreshed',
      code: 'OK',
      message: 'access_token 已通过 refresh_token 恢复',
      accessTokenUsableBefore: false,
      accessTokenUsableAfter: true,
      tokenExpiresAt: renewed.tokenExpiresAt,
    })
    recoverAccountAfterTokenSuccess(refreshAccount(account.id) ?? account)
    const nextAccount = refreshAccount(account.id) ?? {
      ...account,
      accessToken: renewed.accessToken,
      refreshToken: renewed.refreshToken,
      tokenExpiresAt: renewed.tokenExpiresAt,
      tokenStatus: 'refreshed',
      tokenCheckedAt,
      tokenMessage: 'access_token 已通过 refresh_token 恢复',
      tokenLastErrorCode: null,
      tokenLastRefreshedAt: tokenCheckedAt,
    }
    return {
      account: nextAccount,
      accessToken: renewed.accessToken,
      action: 'refreshed',
      accessTokenUsable: true,
      refreshAttempted: true,
      requiresReimport: false,
      message: 'access_token 已通过 refresh_token 恢复',
      tokenCheckedAt,
      tokenLastRefreshedAt: tokenCheckedAt,
    }
  } catch (error) {
    const info = appErrorInfo(error)
    const message = `access_token 已失效，refresh_token 兜底恢复失败: ${info.message}`
    markAccountReimportRequired(account, info.code, message, tokenCheckedAt)
    recordAccountTokenEvent({
      accountId: account.id,
      parseJobId: options.parseJobId,
      trigger: options.trigger,
      action: 'refresh',
      status: 'failed',
      code: info.code,
      message,
      accessTokenUsableBefore: false,
      accessTokenUsableAfter: false,
    })
    throw upstreamError('OPEN_PLATFORM_REIMPORT_REQUIRED', message)
  }
}
