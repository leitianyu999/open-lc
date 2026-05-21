import { eq, lt, sql } from 'drizzle-orm'
import { db } from '../db'
import { accountHealthChecks, baiduAccounts, type BaiduAccount, type User } from '../db/schema'
import { badRequest, notFound } from '../lib/errors'
import { getAccountHealthSettings } from '../settings/service'
import { probeBaiduAccountCookie, probeBaiduOpenPlatform, recordAccountHealthCheck, type AccountProbeResult, type DisabledSource } from './accountProbe'
import { accountUsabilityMessage, accountUsabilityReason, isHealthManagedDisabledSource } from './accountUsability'
import { cleanupAccountTokenEvents, verifyOpenPlatformToken } from './openPlatformToken'
import { recordAccountStatusEvent } from './accounts'

type SkippedHealthResult = Omit<AccountProbeResult, 'status'> & { status: 'skipped_locked' }
type HealthResult = AccountProbeResult | SkippedHealthResult

let maintenanceRunning = false

const sourceForExistingFailure = (account: BaiduAccount) => {
  const source = account.disabledSource
  if (
    source === 'admin' ||
    source === 'owner' ||
    source === 'health_cookie_invalid' ||
    source === 'health_not_svip' ||
    source === 'health_low_space' ||
    source === 'health_bdstoken_invalid' ||
    source === 'health_transient_failure' ||
    source === 'open_platform_reimport_required' ||
    source === 'risk_control' ||
    source === 'delete_needs_verify'
  ) {
    return source
  }
  return null
}

const updateAccountHealth = (account: BaiduAccount, result: HealthResult, actor?: User | null) => {
  const now = new Date()
  const existingSource = sourceForExistingFailure(account)
  const canAutoRecover = isHealthManagedDisabledSource(account.disabledSource)
  const failures =
    result.status === 'healthy' || result.status === 'skipped_locked' ? 0 : result.deterministic ? 0 : (account.healthConsecutiveFailures ?? 0) + 1
  const thresholdReached = failures >= getAccountHealthSettings().accountHealthTransientFailureThreshold
  const shouldDisable = result.deterministic || thresholdReached
  const canHealthManageStatus = account.disabledSource !== 'admin' && account.disabledSource !== 'owner'
  const disabledSource = result.disabledSource ?? (thresholdReached ? 'health_transient_failure' : existingSource)
  const update: Partial<typeof baiduAccounts.$inferInsert> = {
    healthStatus: result.status,
    healthMessage: result.message.slice(0, 300),
    healthCheckedAt: now,
    loginValid: result.loginValid ?? null,
    bdstokenValid: result.bdstokenValid ?? null,
    isSvip: result.isSvip ?? null,
    vipLeftSeconds: result.vipLeftSeconds ?? null,
    vipExpiresAt: result.vipExpiresAt ?? null,
    quotaTotalBytes: result.quotaTotalBytes ?? null,
    quotaUsedBytes: result.quotaUsedBytes ?? null,
    quotaFreeBytes: result.quotaFreeBytes ?? null,
    healthConsecutiveFailures: failures,
    healthLastErrorCode: result.status === 'healthy' ? null : result.code,
    updatedAt: now,
  }

  if (result.uk) update.uk = result.uk
  if (result.baiduName) update.baiduName = result.baiduName
  if (result.vipType) update.vipType = result.vipType

  if (result.status === 'healthy') {
    update.reason = canAutoRecover ? '' : account.reason
    update.lastFailureCode = canAutoRecover ? null : account.lastFailureCode
    update.disabledSource = canAutoRecover ? null : account.disabledSource
    update.cooldownUntil = canAutoRecover ? null : account.cooldownUntil
    if (account.status === 'disabled' && canAutoRecover) {
      update.status = 'active'
    }
  } else if (shouldDisable && canHealthManageStatus) {
    update.status = 'disabled'
    update.reason = result.message.slice(0, 300)
    update.disabledSource = disabledSource
    update.cooldownUntil = null
    update.lockedUntil = null
    update.lastFailureAt = now
    update.lastFailureCode = result.code
  }

  db.update(baiduAccounts).set(update).where(eq(baiduAccounts.id, account.id)).run()

  const nextStatus = update.status ?? account.status
  const nextReason = update.reason ?? account.reason
  if (
    nextStatus !== account.status ||
    nextReason !== account.reason ||
    (update.disabledSource !== undefined && update.disabledSource !== account.disabledSource)
  ) {
    recordAccountStatusEvent({
      accountId: account.id,
      oldStatus: account.status,
      newStatus: nextStatus,
      oldReason: account.reason,
      newReason: nextReason,
      source: result.status === 'healthy' ? 'health_recover' : 'health_check',
      code: result.code,
      actorUserId: actor?.id,
      message: result.message,
    })
  }
}

export const runAccountHealthCheck = async (
  account: BaiduAccount,
  options: {
    skipLocked?: boolean
    actor?: User | null
    persist?: boolean
  } = {},
) => {
  const startedAt = Date.now()
  if (options.skipLocked && account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
    const result: HealthResult = {
      status: 'skipped_locked',
      code: 'ACCOUNT_LOCKED',
      message: '账号正在执行解析任务，本次跳过健康检测',
      deterministic: false,
      durationMs: 0,
    }
    if (options.persist !== false) {
      recordAccountHealthCheck(account.id, result)
    }
    return result
  }

  const result =
    account.credentialSource === 'open_platform'
      ? await (async () => {
          try {
            const token = await verifyOpenPlatformToken(account, {
              trigger: 'health_check',
              allowRefreshFallback: true,
            })
            return await probeBaiduOpenPlatform(account.refreshToken ?? '', {
              accessTokenOverride: token.accessToken,
              skipRefresh: true,
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const code =
              error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'OPEN_PLATFORM_TOKEN_CHECK_FAILED'
            return {
              status: 'failed' as const,
              code,
              message,
              deterministic: true,
              disabledSource: 'open_platform_reimport_required' as const,
              loginValid: false,
              bdstokenValid: true,
              isSvip: null,
              durationMs: Date.now() - startedAt,
              tokenExpiresAt: null,
            }
          }
        })()
      : await probeBaiduAccountCookie(account.cookie)

  if (options.persist !== false) {
    recordAccountHealthCheck(account.id, result)
    updateAccountHealth(account, result, options.actor)
  }
  return {
    ...result,
    consecutiveFailures: result.deterministic || result.status === 'healthy' ? 0 : (account.healthConsecutiveFailures ?? 0) + 1,
  }
}

export const runAccountHealthCheckById = async (accountId: number, actor?: User | null) => {
  const account = db.select().from(baiduAccounts).where(eq(baiduAccounts.id, accountId)).get()
  if (!account) throw notFound('ACCOUNT_NOT_FOUND', '账号不存在')
  return runAccountHealthCheck(account, { actor })
}

export const assertAccountHealthyForEnable = async (account: BaiduAccount, actor: User) => {
  const result = await runAccountHealthCheck(account, { actor })
  if (result.status !== 'healthy') {
    throw badRequest(result.code, result.message)
  }
  const refreshed = db.select().from(baiduAccounts).where(eq(baiduAccounts.id, account.id)).get()
  const reason = refreshed ? accountUsabilityReason({ ...refreshed, status: 'active', cooldownUntil: null, lockedUntil: null }) : null
  if (reason) {
    throw badRequest('ACCOUNT_NOT_USABLE', accountUsabilityMessage(reason), { reason })
  }
  return result
}

export const runAccountHealthMaintenance = async () => {
  if (maintenanceRunning) return { checked: 0, skipped: true }
  maintenanceRunning = true
  let checked = 0
  try {
    const cutoff = new Date(Date.now() - getAccountHealthSettings().accountHealthHistoryTtlDays * 24 * 60 * 60 * 1000)
    db.delete(accountHealthChecks).where(lt(accountHealthChecks.createdAt, cutoff)).run()
    cleanupAccountTokenEvents()

    const accounts = db.select().from(baiduAccounts).orderBy(sql`${baiduAccounts.id} ASC`).all()
    for (const account of accounts) {
      await runAccountHealthCheck(account, { skipLocked: true })
      checked += 1
    }
    return { checked, skipped: false }
  } finally {
    maintenanceRunning = false
  }
}

export const listAccountHealthChecks = (accountId: number, page: number, pageSize: number) => {
  const offset = (page - 1) * pageSize
  const items = db
    .select()
    .from(accountHealthChecks)
    .where(eq(accountHealthChecks.accountId, accountId))
    .orderBy(sql`${accountHealthChecks.id} DESC`)
    .limit(pageSize)
    .offset(offset)
    .all()
  const [total] = db.select({ value: sql<number>`COUNT(*)` }).from(accountHealthChecks).where(eq(accountHealthChecks.accountId, accountId)).all()
  return {
    items,
    page,
    pageSize,
    total: Number(total?.value ?? 0),
  }
}
