import { upstreamError } from './errors'
import { getParseLimits } from '../settings/service'

type RequestOptions = {
  method?: 'GET' | 'POST' | 'HEAD'
  query?: Record<string, string | number | boolean | undefined>
  form?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
  redirect?: 'follow' | 'error' | 'manual'
  label?: string
}

export const withQuery = (url: string, query?: RequestOptions['query']) => {
  const target = new URL(url)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) target.searchParams.set(key, String(value))
  }
  return target.toString()
}

export const requestJson = async <T>(url: string, options: RequestOptions = {}): Promise<T> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), getParseLimits().requestTimeoutMs)

  try {
    const body = buildFormBody(options.form)

    const requestUrl = withQuery(url, options.query)
    const response = await fetch(requestUrl, {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers: {
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...options.headers,
      },
      body,
      signal: controller.signal,
      redirect: options.redirect,
    })

    const text = await response.text()
    if (!response.ok) {
      throw upstreamError('BAIDU_HTTP_FAILED', `百度接口 HTTP ${response.status}: ${options.label ?? new URL(url).pathname}`, {
        label: options.label,
        url: redactUrl(requestUrl),
        status: response.status,
        body: text.slice(0, 500),
      })
    }

    try {
      return JSON.parse(text) as T
    } catch {
      throw upstreamError('BAIDU_BAD_JSON', '百度接口返回不是 JSON', { body: text.slice(0, 500) })
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw upstreamError('BAIDU_TIMEOUT', '百度接口请求超时')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export const requestText = async (url: string, options: RequestOptions = {}) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), getParseLimits().requestTimeoutMs)

  try {
    const body = buildFormBody(options.form)

    const requestUrl = withQuery(url, options.query)
    const response = await fetch(requestUrl, {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers: {
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...options.headers,
      },
      body,
      signal: controller.signal,
      redirect: options.redirect,
    })

    const text = await response.text()
    if (!response.ok) {
      throw upstreamError('BAIDU_HTTP_FAILED', `百度接口 HTTP ${response.status}: ${options.label ?? new URL(url).pathname}`, {
        label: options.label,
        url: redactUrl(requestUrl),
        status: response.status,
        body: text.slice(0, 500),
      })
    }
    return text
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw upstreamError('BAIDU_TIMEOUT', '百度接口请求超时')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export const requestHeadLocation = async (url: string, headers?: Record<string, string>) => {
  const maxRedirects = 5
  let currentUrl = url
  let lastStatus = 0
  let lastMethod: 'HEAD' | 'GET' = 'HEAD'

  for (let hop = 0; hop < maxRedirects; hop += 1) {
    const head = await requestManualHeaders(currentUrl, 'HEAD', headers)
    lastStatus = head.status
    lastMethod = 'HEAD'

    if (isRedirectStatus(head.status)) {
      currentUrl = normalizeLocation(head.location, currentUrl)
      continue
    }
    if (isFinalStatus(head.status)) return currentUrl

    const rangedGet = await requestManualHeaders(currentUrl, 'GET', {
      ...headers,
      Range: 'bytes=0-0',
    })
    lastStatus = rangedGet.status
    lastMethod = 'GET'

    if (isRedirectStatus(rangedGet.status)) {
      currentUrl = normalizeLocation(rangedGet.location, currentUrl)
      continue
    }
    if (isFinalStatus(rangedGet.status)) return currentUrl

    throw upstreamError('BAIDU_HEAD_FAILED', `真实链接跳转失败: HTTP ${rangedGet.status}`, {
      method: 'GET',
      url: currentUrl,
      contentType: rangedGet.contentType,
    })
  }

  throw upstreamError('BAIDU_HEAD_FAILED', '真实链接跳转失败: 重定向次数过多', {
    method: lastMethod,
    status: lastStatus,
    url: currentUrl,
    maxRedirects,
  })
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const buildFormBody = (form?: RequestOptions['form']) => {
  if (!form) return undefined
  const entries: [string, string][] = []
  for (const [key, value] of Object.entries(form)) {
    if (value !== undefined) entries.push([key, String(value)])
  }
  return new URLSearchParams(entries)
}

const isRedirectStatus = (status: number) =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308

const isFinalStatus = (status: number) => status >= 200 && status < 300

const normalizeLocation = (location: string | null, baseUrl: string) => {
  if (!location) throw upstreamError('BAIDU_HEAD_FAILED', '真实链接跳转失败: 缺少 Location', { url: baseUrl })
  try {
    return new URL(location, baseUrl).toString()
  } catch {
    throw upstreamError('BAIDU_HEAD_FAILED', '真实链接跳转失败: Location 无效', { location, url: baseUrl })
  }
}

const redactUrl = (url: string) => {
  const target = new URL(url)
  for (const key of ['bdstoken', 'sekey', 'sign', 'timestamp', 'logid', 'jsToken', 'access_token', 'refresh_token', 'client_secret', 'secret_key', 'refresh_ui']) {
    if (target.searchParams.has(key)) target.searchParams.set(key, '[redacted]')
  }
  return target.toString()
}

const requestManualHeaders = async (
  url: string,
  method: 'HEAD' | 'GET',
  headers?: Record<string, string>,
) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), getParseLimits().requestTimeoutMs)

  try {
    const response = await fetch(url, {
      method,
      headers,
      redirect: 'manual',
      signal: controller.signal,
    })

    await response.body?.cancel().catch(() => undefined)
    return {
      status: response.status,
      location: response.headers.get('location'),
      contentType: response.headers.get('content-type'),
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw upstreamError('BAIDU_TIMEOUT', '百度接口请求超时')
    }
    if (method === 'HEAD') {
      return {
        status: 0,
        location: null,
        contentType: null,
      }
    }
    throw upstreamError('BAIDU_HEAD_FAILED', '真实链接跳转失败: 网络错误', {
      url,
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    clearTimeout(timeout)
  }
}
