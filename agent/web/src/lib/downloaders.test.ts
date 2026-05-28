import { describe, expect, test } from 'bun:test'
import { downloaderRequestOptions, downloaderTargetDir, safeRelativeSourceDir, type DownloaderConfig } from './downloaders'

const downloader = (input: Partial<DownloaderConfig>): DownloaderConfig => ({
  id: 'test',
  name: 'Test',
  type: 'aria2',
  rpcUrl: 'http://127.0.0.1:6800/jsonrpc',
  token: '',
  downloadDir: '',
  preserveSourceDir: false,
  enabled: true,
  isDefault: true,
  ...input,
})

describe('downloader target directories', () => {
  test('ignores source directory when preservation is disabled', () => {
    expect(downloaderTargetDir(downloader({ downloadDir: '/downloads' }), { sourceDir: '/A/B' })).toBe('/downloads')
  })

  test('appends source directory under configured download directory', () => {
    expect(downloaderTargetDir(downloader({ downloadDir: '/downloads', preserveSourceDir: true }), { sourceDir: '/A/B' })).toBe('/downloads/A/B')
  })

  test('keeps base directory for empty or root source directory', () => {
    const config = downloader({ downloadDir: '/downloads', preserveSourceDir: true })
    expect(downloaderTargetDir(config, { sourceDir: '/' })).toBe('/downloads')
    expect(downloaderTargetDir(config, { sourceDir: '' })).toBe('/downloads')
    expect(downloaderTargetDir(config, { sourceDir: null })).toBe('/downloads')
  })

  test('uses relative source directory in output when no download directory is configured', () => {
    const config = downloader({ preserveSourceDir: true })
    expect(downloaderTargetDir(config, { sourceDir: '/A/B' })).toBe('')
    expect(downloaderRequestOptions(config, { filename: '05.mp4', sourceDir: '/影视分享2026/剧集更新/ZHIDUAN' })).toEqual({
      dir: '',
      out: '影视分享2026/剧集更新/ZHIDUAN/05.mp4',
    })
  })

  test('cleans unsafe or noisy source directory segments', () => {
    expect(safeRelativeSourceDir('/A//../B/./C')).toBe('A/B/C')
    expect(downloaderTargetDir(downloader({ downloadDir: '/downloads/', preserveSourceDir: true }), { sourceDir: '\\A\\B' })).toBe('/downloads/A/B')
    expect(downloaderRequestOptions(downloader({ preserveSourceDir: true }), { filename: 'demo.bin', sourceDir: '/A//../B/./C' })).toEqual({
      dir: '',
      out: 'A/B/C/demo.bin',
    })
  })
})
