import { describe, expect, test } from 'bun:test'
import { formatVipRemaining } from './format'

describe('formatVipRemaining', () => {
  test('formats days with ceiling', () => {
    expect(formatVipRemaining(86400)).toBe('约 1 天')
    expect(formatVipRemaining(86401)).toBe('约 2 天')
  })

  test('formats hours with ceiling', () => {
    expect(formatVipRemaining(3600)).toBe('约 1 小时')
    expect(formatVipRemaining(3601)).toBe('约 2 小时')
  })

  test('formats short and empty values', () => {
    expect(formatVipRemaining(59)).toBe('少于 1 小时')
    expect(formatVipRemaining(null)).toBe('')
    expect(formatVipRemaining(0)).toBe('')
  })
})
