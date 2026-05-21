import type { BaiduAccount } from '../db/schema'

export type AccountUsabilityReason = 'disabled' | 'cooldown' | 'locked' | 'health_not_healthy' | 'not_svip' | 'open_platform_token_invalid'

export const isHealthManagedDisabledSource = (source?: string | null) => Boolean(source?.startsWith('health_')) || source === 'open_platform_reimport_required'

export const isOpenPlatformTokenUsable = (account: Pick<BaiduAccount, 'credentialSource' | 'tokenStatus'>) =>
  account.credentialSource !== 'open_platform' || account.tokenStatus === 'valid' || account.tokenStatus === 'refreshed'

export const accountUsabilityReason = (
  account: Pick<BaiduAccount, 'status' | 'cooldownUntil' | 'lockedUntil' | 'healthStatus' | 'isSvip' | 'credentialSource' | 'tokenStatus'>,
  options: {
    now?: Date
    requireUnlocked?: boolean
  } = {},
): AccountUsabilityReason | null => {
  const now = options.now ?? new Date()
  if (account.status !== 'active') return 'disabled'
  if (account.cooldownUntil && account.cooldownUntil.getTime() > now.getTime()) return 'cooldown'
  if (options.requireUnlocked && account.lockedUntil && account.lockedUntil.getTime() > now.getTime()) return 'locked'
  if (account.healthStatus !== 'healthy') return 'health_not_healthy'
  if (account.isSvip !== true) return 'not_svip'
  if (!isOpenPlatformTokenUsable(account)) return 'open_platform_token_invalid'
  return null
}

export const isUsableLocalAccount = (
  account: Pick<BaiduAccount, 'status' | 'cooldownUntil' | 'lockedUntil' | 'healthStatus' | 'isSvip' | 'credentialSource' | 'tokenStatus'>,
  options: {
    now?: Date
    requireUnlocked?: boolean
  } = {},
) => accountUsabilityReason(account, options) === null

export const accountUsabilityMessage = (reason: AccountUsabilityReason | null) => {
  if (!reason) return '账号可用'
  if (reason === 'disabled') return '账号未启用'
  if (reason === 'cooldown') return '账号冷却中'
  if (reason === 'locked') return '账号正在执行任务'
  if (reason === 'health_not_healthy') return '账号未通过健康检测'
  if (reason === 'not_svip') return '账号不是 SVIP'
  if (reason === 'open_platform_token_invalid') return '开放平台 token 不可用'
  return '账号不可用'
}
