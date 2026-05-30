export class AppError extends Error {
  public readonly code: string
  public readonly status: number
  public readonly details?: unknown

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError

export const unknownErrorMessage = (error: unknown, fallback = '未知错误') => {
  if (error instanceof Error && error.message) return error.message

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.trim()) return record.message
    if (typeof record.code === 'string' && record.code.trim()) return record.code
    try {
      return JSON.stringify(record)
    } catch {
      return fallback
    }
  }

  if (error === undefined || error === null || error === '') return fallback
  return String(error)
}

export const badRequest = (code: string, message: string, details?: unknown) => new AppError(code, message, 400, details)

export const unauthorized = (code: string, message: string, details?: unknown) => new AppError(code, message, 401, details)

export const forbidden = (code: string, message: string, details?: unknown) => new AppError(code, message, 403, details)

export const notFound = (code: string, message: string, details?: unknown) => new AppError(code, message, 404, details)

export const conflict = (code: string, message: string, details?: unknown) => new AppError(code, message, 409, details)

export const upstreamError = (code: string, message: string, details?: unknown) => new AppError(code, message, 502, details)

export const unavailable = (code: string, message: string, details?: unknown) => new AppError(code, message, 503, details)
