import { describe, expect, test } from 'bun:test'
import { formatUpstreamErrorMessage } from './client'

describe('formatUpstreamErrorMessage', () => {
  test('formats object info without object placeholder', () => {
    const message = formatUpstreamErrorMessage({
      errno: 12,
      info: { errno: 12, path: '/我的资源/下载' },
    })

    expect(message).toContain('"path":"/我的资源/下载"')
    expect(message).not.toContain('[object Object]')
  })

  test('formats array info without object placeholder', () => {
    const message = formatUpstreamErrorMessage({
      errno: 12,
      info: [{ errno: 12, path: '/a' }],
    })

    expect(message).toContain('"path":"/a"')
    expect(message).not.toContain('[object Object]')
  })

  test('prefers show_msg over structured info', () => {
    expect(
      formatUpstreamErrorMessage({
        show_msg: '上游明确错误',
        info: { errno: 12 },
        errno: 12,
      }),
    ).toBe('上游明确错误')
  })

  test('falls back to errno label', () => {
    expect(formatUpstreamErrorMessage({ errno: 31066 })).toBe('errno=31066')
  })

  test('supports error_code and explicit fallback', () => {
    expect(formatUpstreamErrorMessage({ error_code: 9019 })).toBe('9019')
    expect(formatUpstreamErrorMessage({}, '需要验证码或触发风控')).toBe('需要验证码或触发风控')
  })
})
