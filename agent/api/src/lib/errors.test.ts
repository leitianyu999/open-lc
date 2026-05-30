import { describe, expect, test } from 'bun:test'
import { unknownErrorMessage } from './errors'

describe('unknownErrorMessage', () => {
  test('uses Error message first', () => {
    expect(unknownErrorMessage(new Error('boom'))).toBe('boom')
  })

  test('uses object message and code fields', () => {
    expect(unknownErrorMessage({ message: '对象消息', code: 'BAD' })).toBe('对象消息')
    expect(unknownErrorMessage({ code: 'BAD' })).toBe('BAD')
  })

  test('serializes plain objects without object placeholder', () => {
    const message = unknownErrorMessage({ reason: 'upstream', nested: { code: 1 } })

    expect(message).toContain('"reason":"upstream"')
    expect(message).not.toContain('[object Object]')
  })

  test('falls back for circular objects and empty values', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(unknownErrorMessage(circular, 'fallback')).toBe('fallback')
    expect(unknownErrorMessage(null, 'fallback')).toBe('fallback')
    expect(unknownErrorMessage(undefined, 'fallback')).toBe('fallback')
  })
})
