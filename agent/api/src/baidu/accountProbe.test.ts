import { describe, expect, test } from 'bun:test'
import { membershipExpiryFromResponse } from './accountProbe'

describe('membershipExpiryFromResponse', () => {
  test('uses svip left seconds first', () => {
    const result = membershipExpiryFromResponse({
      reminder: {
        serverTime: 1_700_000_000,
        svip: { leftseconds: 86_400 },
        vip: { leftseconds: 3_600 },
      },
    })

    expect(result.vipLeftSeconds).toBe(86_400)
    expect(result.vipExpiresAt?.getTime()).toBe(1_700_086_400_000)
  })

  test('falls back to vip left seconds', () => {
    const result = membershipExpiryFromResponse({
      currenttime: 1_700_000_000,
      reminder: {
        vip: { leftseconds: 3_600 },
      },
    })

    expect(result.vipLeftSeconds).toBe(3_600)
    expect(result.vipExpiresAt?.getTime()).toBe(1_700_003_600_000)
  })

  test('returns nulls without positive remaining seconds', () => {
    expect(membershipExpiryFromResponse({ reminder: { svip: { leftseconds: 0 } } })).toEqual({
      vipLeftSeconds: null,
      vipExpiresAt: null,
    })
  })
})
