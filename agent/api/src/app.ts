import { Hono } from 'hono'
import type { Context } from 'hono'
import { serveStatic } from 'hono/bun'
import { config } from './config'
import { isAppError } from './lib/errors'
import { typedRoutes } from './http/routes'

const defaultWebDistRoot = new URL('../../web/dist/', import.meta.url).pathname

export type CreateAgentAppOptions = {
  webDistRoot?: string
}

const normalizeRoot = (root: string) => root.endsWith('/') ? root : `${root}/`

export const resolveWebDistRoot = (webDistRoot = config.webDistRoot) =>
  normalizeRoot(webDistRoot || defaultWebDistRoot)

const webAssetResponse = async (webDistRoot: string, name: string, fallbackName?: string) => {
  const file = Bun.file(`${webDistRoot}${name}`)
  if (await file.exists()) return new Response(file)

  if (fallbackName) {
    const fallback = Bun.file(`${webDistRoot}${fallbackName}`)
    if (await fallback.exists()) return new Response(fallback)
  }

  return new Response('404 Not Found', { status: 404 })
}

export const createAgentApp = (options: CreateAgentAppOptions = {}) => {
  const app = new Hono()
  const webDistRoot = resolveWebDistRoot(options.webDistRoot)
  const webDevProxyUrl = config.webDevProxyUrl
  const webDevProxyEnabled = Boolean(webDevProxyUrl && config.nodeEnv !== 'production')
  const webDevProxyPrefixes = [
    '/@vite',
    '/@react-refresh',
    '/src/',
    '/node_modules/.vite/',
    '/assets/',
  ]
  const webAssetPaths = new Set([
    '/apple-touch-icon.png',
    '/favicon.ico',
    '/favicon.png',
    '/icon.png',
  ])

  const shouldProxyToWebDev = (path: string) => {
    if (!webDevProxyEnabled) return false
    if (path === '/' || webAssetPaths.has(path)) return true
    if (path.startsWith('/api/') || path === '/health') return false
    return webDevProxyPrefixes.some((prefix) => path.startsWith(prefix))
  }

  const proxyToWebDev = async (c: Context) => {
    const target = new URL(c.req.url)
    const base = new URL(webDevProxyUrl)
    target.protocol = base.protocol
    target.host = base.host
    target.username = base.username
    target.password = base.password

    const headers = new Headers(c.req.raw.headers)
    headers.set('host', base.host)

    return fetch(target, {
      method: c.req.method,
      headers,
      body: c.req.raw.body,
      redirect: 'manual',
    })
  }

  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json({
        code: error.code,
        message: error.message,
        ...(config.debug && error.details !== undefined ? { details: error.details } : {}),
      }, error.status as 400 | 401 | 403 | 404 | 409 | 502 | 503)
    }

    console.error(error)
    return c.json({ code: 'INTERNAL_ERROR', message: '服务内部错误' }, 500)
  })

  app.route('/', typedRoutes)

  app.use('*', async (c, next) => {
    if (!shouldProxyToWebDev(c.req.path)) {
      await next()
      return
    }

    try {
      return await proxyToWebDev(c)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.html(`Web dev server 代理失败：${message}。请确认 bun run dev:agent-web 正在运行。`, 503)
    }
  })

  app.use('/assets/*', serveStatic({ root: webDistRoot }))
  app.get('/apple-touch-icon.png', () => webAssetResponse(webDistRoot, 'apple-touch-icon.png'))
  app.get('/favicon.ico', () => webAssetResponse(webDistRoot, 'favicon.ico', 'favicon.png'))
  app.get('/favicon.png', () => webAssetResponse(webDistRoot, 'favicon.png'))
  app.get('/icon.png', () => webAssetResponse(webDistRoot, 'icon.png'))
  app.get('/', async (c) => {
    const index = Bun.file(`${webDistRoot}index.html`)
    if (!(await index.exists())) {
      return c.html('SPA 尚未构建，请运行 bun run build:agent-web，或开发时使用 bun run dev:agent-web。', 503)
    }
    return c.html(await index.text())
  })

  return app
}
