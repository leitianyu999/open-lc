import { eq } from 'drizzle-orm'
import { db } from '../db'
import { appSettings } from '../db/schema'
import { badRequest, forbidden, unauthorized } from '../lib/errors'

export const riskConsentTypes = ['open_platform_account', 'cookie_account', 'broker_execution'] as const

export type RiskConsentType = (typeof riskConsentTypes)[number]

const keys = {
  enabled: 'agent_password_enabled',
  salt: 'agent_password_salt',
  hash: 'agent_password_hash',
} as const

const riskConsentKeys: Record<RiskConsentType, string> = {
  open_platform_account: 'agent_consent_open_platform_account_accepted_at',
  cookie_account: 'agent_consent_cookie_account_accepted_at',
  broker_execution: 'agent_consent_broker_execution_accepted_at',
}

const readSetting = (key: string) => db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value.trim() ?? ''

const writeSetting = (key: string, value: string) => {
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
    .run()
}

const deleteSetting = (key: string) => {
  db.delete(appSettings).where(eq(appSettings.key, key)).run()
}

const hashPassword = async (password: string, salt: string) => {
  const bytes = new TextEncoder().encode(`${salt}:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const normalizePassword = (password: unknown) => String(password ?? '')

export const isRiskConsentType = (value: string): value is RiskConsentType => riskConsentTypes.includes(value as RiskConsentType)

export const getRiskConsentStatus = () =>
  Object.fromEntries(riskConsentTypes.map((type) => [type, Boolean(readSetting(riskConsentKeys[type]))])) as Record<RiskConsentType, boolean>

export const getSecurityStatus = () => ({
  passwordEnabled: readSetting(keys.enabled) === 'true',
  riskConsents: getRiskConsentStatus(),
})

export const acceptRiskConsent = (type: RiskConsentType) => {
  writeSetting(riskConsentKeys[type], new Date().toISOString())
  return getSecurityStatus()
}

export const requireRiskConsent = (type: RiskConsentType) => {
  if (readSetting(riskConsentKeys[type])) return true
  throw forbidden('RISK_CONSENT_REQUIRED', '需要先阅读并同意风险提示与责任声明', { type })
}

export const verifyAgentPassword = async (password: unknown) => {
  const status = getSecurityStatus()
  if (!status.passwordEnabled) return true

  const normalized = normalizePassword(password)
  if (!normalized) throw unauthorized('AGENT_PASSWORD_REQUIRED', '需要输入 Agent 访问密码')

  const salt = readSetting(keys.salt)
  const storedHash = readSetting(keys.hash)
  if (!salt || !storedHash) throw unauthorized('AGENT_PASSWORD_REQUIRED', 'Agent 访问密码尚未正确配置')

  const hash = await hashPassword(normalized, salt)
  if (hash !== storedHash) throw unauthorized('AGENT_PASSWORD_INVALID', 'Agent 访问密码不正确')
  return true
}

export const loginWithAgentPassword = async (password: unknown) => {
  await verifyAgentPassword(password)
  return getSecurityStatus()
}

export const updateSecuritySettings = async (input: { enabled: boolean; password?: unknown }) => {
  if (!input.enabled) {
    writeSetting(keys.enabled, 'false')
    deleteSetting(keys.salt)
    deleteSetting(keys.hash)
    return getSecurityStatus()
  }

  const password = normalizePassword(input.password)
  if (!password.trim()) throw badRequest('BAD_AGENT_PASSWORD', '访问密码不能为空')

  const salt = crypto.randomUUID()
  writeSetting(keys.enabled, 'true')
  writeSetting(keys.salt, salt)
  writeSetting(keys.hash, await hashPassword(password, salt))
  return getSecurityStatus()
}
