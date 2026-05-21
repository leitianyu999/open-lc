import { describe, expect, test } from 'bun:test'
import { accountUsabilityReason, isHealthManagedDisabledSource, isUsableLocalAccount } from './accountUsability'
import type { BaiduAccount } from '../db/schema'

const account = (patch: Partial<BaiduAccount> = {}) =>
  ({
    status: 'active',
    cooldownUntil: null,
    lockedUntil: null,
    healthStatus: 'healthy',
    isSvip: true,
    credentialSource: 'cookie',
    tokenStatus: 'unknown',
    disabledSource: null,
    ...patch,
  }) as BaiduAccount

describe('account usability', () => {
  test('accepts active healthy SVIP cookie account', () => {
    expect(isUsableLocalAccount(account())).toBe(true)
    expect(accountUsabilityReason(account())).toBeNull()
  })

  test('rejects non-SVIP and unhealthy accounts', () => {
    expect(accountUsabilityReason(account({ isSvip: false }))).toBe('not_svip')
    expect(accountUsabilityReason(account({ healthStatus: 'failed' }))).toBe('health_not_healthy')
  })

  test('requires usable open platform token status', () => {
    expect(isUsableLocalAccount(account({ credentialSource: 'open_platform', tokenStatus: 'valid' }))).toBe(true)
    expect(isUsableLocalAccount(account({ credentialSource: 'open_platform', tokenStatus: 'refreshed' }))).toBe(true)
    expect(accountUsabilityReason(account({ credentialSource: 'open_platform', tokenStatus: 'reimport_required' }))).toBe('open_platform_token_invalid')
  })

  test('distinguishes health-managed disabled sources from explicit user actions', () => {
    expect(isHealthManagedDisabledSource('health_not_svip')).toBe(true)
    expect(isHealthManagedDisabledSource('open_platform_reimport_required')).toBe(true)
    expect(isHealthManagedDisabledSource('owner')).toBe(false)
    expect(isHealthManagedDisabledSource('admin')).toBe(false)
  })
})
