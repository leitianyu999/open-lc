import { describe, expect, test } from 'bun:test'
import { compareVersions, normalizeVersion, releaseFromGitHubResponse } from './service'

describe('update service version parsing', () => {
  test('normalizes v-prefixed semver tags', () => {
    expect(normalizeVersion('v1.2.3')?.version).toBe('1.2.3')
    expect(normalizeVersion('1.2.3')?.version).toBe('1.2.3')
  })

  test('rejects unsupported tag shapes', () => {
    expect(normalizeVersion('v1.2')).toBeNull()
    expect(normalizeVersion('v1.2.3-beta.1')).toBeNull()
    expect(normalizeVersion('release-1.2.3')).toBeNull()
  })

  test('compares numeric semver parts', () => {
    expect(compareVersions('1.0.1', '1.0.2')).toBe(-1)
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1)
    expect(compareVersions('1.0.0', 'v1.0.0')).toBe(0)
    expect(compareVersions('bad', '1.0.0')).toBeNull()
  })

  test('extracts release metadata from GitHub latest release response', () => {
    expect(
      releaseFromGitHubResponse({
        tag_name: 'v1.0.2',
        html_url: 'https://github.com/LeUKi/open-lc/releases/tag/v1.0.2',
      }),
    ).toEqual({
      latestTag: 'v1.0.2',
      latestVersion: '1.0.2',
      releaseUrl: 'https://github.com/LeUKi/open-lc/releases/tag/v1.0.2',
    })
  })

  test('rejects incomplete release metadata', () => {
    expect(releaseFromGitHubResponse({ tag_name: 'v1.0.2' })).toBeNull()
    expect(releaseFromGitHubResponse({ tag_name: 'v1.0.2-beta.1', html_url: 'https://example.com' })).toBeNull()
  })
})
