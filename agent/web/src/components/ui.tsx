import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock, X, XCircle } from 'lucide-react'

let measureCanvas: HTMLCanvasElement | null = null
const resizeSubscribers = new Set<() => void>()
let resizeListening = false
let resizeFrame = 0

const emitResize = () => {
  resizeSubscribers.forEach((callback) => callback())
}

const handleWindowResize = () => {
  if (resizeFrame) cancelAnimationFrame(resizeFrame)
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = 0
    emitResize()
  })
}

const subscribeWindowResize = (callback: () => void) => {
  if (typeof window === 'undefined') return () => {}
  resizeSubscribers.add(callback)
  if (!resizeListening) {
    window.addEventListener('resize', handleWindowResize)
    resizeListening = true
  }
  return () => {
    resizeSubscribers.delete(callback)
    if (resizeSubscribers.size === 0 && resizeListening) {
      window.removeEventListener('resize', handleWindowResize)
      if (resizeFrame) cancelAnimationFrame(resizeFrame)
      resizeFrame = 0
      resizeListening = false
    }
  }
}

const measureTextWidth = (text: string, font: string) => {
  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  const context = measureCanvas.getContext('2d')
  if (!context) return text.length * 8
  context.font = font
  return context.measureText(text).width
}

const middleEllipsis = (text: string, width: number, font: string) => {
  if (!text || width <= 0) return text
  if (measureTextWidth(text, font) <= width) return text

  const marker = '...'
  const markerWidth = measureTextWidth(marker, font)
  if (markerWidth >= width) return marker

  let low = 1
  let high = Math.max(1, text.length - 1)
  let best = marker

  while (low <= high) {
    const keep = Math.floor((low + high) / 2)
    const head = Math.ceil(keep / 2)
    const tail = Math.floor(keep / 2)
    const candidate = `${text.slice(0, head)}${marker}${tail > 0 ? text.slice(text.length - tail) : ''}`
    if (measureTextWidth(candidate, font) <= width) {
      best = candidate
      low = keep + 1
    } else {
      high = keep - 1
    }
  }

  return best
}

export function Panel({ children, className = '' }: { children: React.ReactNode, className?: string }) {
  return <section className={`rounded-lg border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/40 ${className}`}>{children}</section>
}

export function InlineAlert({
  children,
  variant = 'info',
  onClose,
  className = '',
}: {
  children: React.ReactNode
  variant?: 'success' | 'error' | 'warning' | 'info'
  onClose?: () => void
  className?: string
}) {
  const styles = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    error: 'border-red-200 bg-red-50 text-red-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    info: 'border-blue-200 bg-blue-50 text-blue-700',
  }
  const hoverStyles = {
    success: 'hover:bg-emerald-100',
    error: 'hover:bg-red-100',
    warning: 'hover:bg-amber-100',
    info: 'hover:bg-blue-100',
  }

  return (
    <div className={`rounded-md border px-3 py-2 text-sm font-semibold ${styles[variant]} ${className}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 break-words">{children}</div>
        {onClose ? (
          <button aria-label="关闭提示" className={`-mr-1 rounded p-1 transition ${hoverStyles[variant]}`} type="button" onClick={onClose}>
            <X className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function MiddleEllipsis({
  text,
  className = '',
}: {
  text: string
  className?: string
}) {
  const wrapperRef = useRef<HTMLSpanElement | null>(null)
  const textRef = useRef<HTMLSpanElement | null>(null)
  const [display, setDisplay] = useState(text)
  const [truncated, setTruncated] = useState(false)
  const [tooltip, setTooltip] = useState<{
    left: number
    top: number
    maxWidth: number
    placement: 'top' | 'bottom'
  } | null>(null)

  const recompute = () => {
    const element = textRef.current
    if (!element) return false
    const width = element.clientWidth
    if (width <= 0) {
      setDisplay(text)
      setTruncated(false)
      return false
    }
    const style = window.getComputedStyle(element)
    const font = style.font
    const fullWidth = measureTextWidth(text, font)
    if (fullWidth <= width) {
      setDisplay(text)
      setTruncated(false)
      return false
    }
    setDisplay(middleEllipsis(text, width, font))
    setTruncated(true)
    return true
  }

  const updateTooltip = () => {
    const element = textRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const maxWidth = Math.min(480, window.innerWidth - 16)
    const tooltipHeight = 40
    const placeOnTop = rect.bottom + 8 + tooltipHeight > window.innerHeight && rect.top - 8 - tooltipHeight > 0
    setTooltip({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - maxWidth - 8)),
      top: placeOnTop ? rect.top - 8 : rect.bottom + 8,
      maxWidth,
      placement: placeOnTop ? 'top' : 'bottom',
    })
  }

  useLayoutEffect(() => {
    recompute()
  }, [text, className])

  useEffect(() => subscribeWindowResize(() => {
    recompute()
  }), [text, className])

  useEffect(() => {
    if (!tooltip) return
    const close = () => setTooltip(null)
    const reposition = () => updateTooltip()
    window.addEventListener('resize', reposition)
    document.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', reposition)
      document.removeEventListener('scroll', close, true)
    }
  }, [tooltip])

  const showTooltip = () => {
    const isTruncated = recompute()
    if (!isTruncated) {
      setTooltip(null)
      return
    }
    updateTooltip()
  }

  return (
    <span
      ref={wrapperRef}
      className="relative block min-w-0"
      onBlur={() => setTooltip(null)}
      onMouseEnter={showTooltip}
      onMouseLeave={() => setTooltip(null)}
    >
      <span ref={textRef} className={`block min-w-0 overflow-hidden whitespace-nowrap ${className}`} aria-label={text}>
        {display}
      </span>
      {tooltip && truncated ? (
        <span
          className="pointer-events-none fixed z-40 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium leading-5 text-white shadow-lg shadow-slate-950/25"
          style={{
            left: tooltip.left,
            top: tooltip.top,
            maxWidth: tooltip.maxWidth,
            transform: tooltip.placement === 'top' ? 'translateY(-100%)' : undefined,
          }}
        >
          {text}
        </span>
      ) : null}
    </span>
  )
}

export function HoverTooltip({
  children,
  content,
  disabled = false,
}: {
  children: React.ReactNode
  content: React.ReactNode
  disabled?: boolean
}) {
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number, top: number, placement: 'top' | 'bottom' } | null>(null)

  const updatePosition = () => {
    const element = triggerRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const tooltipHeight = 36
    const placeOnTop = rect.bottom + 8 + tooltipHeight > window.innerHeight && rect.top - 8 - tooltipHeight > 0
    setPosition({
      left: rect.left + rect.width / 2,
      top: placeOnTop ? rect.top - 8 : rect.bottom + 8,
      placement: placeOnTop ? 'top' : 'bottom',
    })
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const reposition = () => updatePosition()
    window.addEventListener('resize', reposition)
    document.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', reposition)
      document.removeEventListener('scroll', close, true)
    }
  }, [open])

  const show = () => {
    if (disabled) return
    updatePosition()
    setOpen(true)
  }

  return (
    <span
      ref={triggerRef}
      className="inline-flex"
      onBlur={() => setOpen(false)}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open && position ? (
        <span
          className="pointer-events-none fixed z-40 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium leading-5 text-white shadow-lg shadow-slate-950/25"
          style={{
            left: position.left,
            top: position.top,
            transform: position.placement === 'top' ? 'translate(-50%, -100%)' : 'translateX(-50%)',
            maxWidth: 280,
          }}
        >
          {content}
        </span>
      ) : null}
    </span>
  )
}

export function Button({
  children,
  className = '',
  variant = 'primary',
  size = 'md',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'md' | 'sm'
}) {
  const variants = {
    primary: 'bg-blue-600 text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700 focus-visible:ring-blue-200',
    secondary: 'bg-white text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 focus-visible:ring-slate-300',
    danger: 'bg-red-600 text-white shadow-sm shadow-red-600/20 hover:bg-red-700 focus-visible:ring-red-200',
    ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-200',
  }
  const sizes = {
    md: 'min-h-10 px-4 py-2 text-sm',
    sm: 'min-h-8 px-3 py-1.5 text-xs',
  }
  return (
    <button
      className={`inline-flex max-w-full items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold outline-none transition focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      type="button"
      {...props}
    >
      {children}
    </button>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${props.className ?? ''}`} />
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${props.className ?? ''}`} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${props.className ?? ''}`} />
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-slate-700">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal text-slate-500">{hint}</span> : null}
    </label>
  )
}

export function EmptyState({ title, text }: { title: string, text?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
      <div className="font-semibold text-slate-700">{title}</div>
      {text ? <div className="mt-1 text-sm text-slate-500">{text}</div> : null}
    </div>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase()
  const styles = normalized === 'active' || normalized === 'success'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : normalized === 'cooldown' || normalized === 'running' || normalized === 'waiting'
      ? 'bg-amber-50 text-amber-700 ring-amber-200'
      : normalized === 'failed' || normalized === 'disabled'
        ? 'bg-red-50 text-red-700 ring-red-200'
        : 'bg-slate-100 text-slate-700 ring-slate-200'
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${styles}`}>{status}</span>
}

export function StateIcon({ status }: { status: 'waiting' | 'queued' | 'running' | 'success' | 'failed' }) {
  if (status === 'success') return <CheckCircle2 className="size-4 text-emerald-600" />
  if (status === 'failed') return <XCircle className="size-4 text-red-600" />
  if (status === 'running') return <Clock className="size-4 text-blue-600" />
  if (status === 'queued') return <Clock className="size-4 text-amber-600" />
  return <AlertCircle className="size-4 text-slate-400" />
}

export function Table({
  children,
  className = '',
  tableClassName = '',
}: {
  children: React.ReactNode
  className?: string
  tableClassName?: string
}) {
  return (
    <div className={`overflow-x-auto rounded-lg border border-slate-200 ${className}`}>
      <table className={`w-full border-collapse text-sm ${tableClassName}`}>{children}</table>
    </div>
  )
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  maxWidthClassName = 'max-w-2xl',
}: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: React.ReactNode
  maxWidthClassName?: string
}) {
  const titleId = useId()
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 px-4 py-6">
      <div className={`flex max-h-[88vh] w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/20 ${maxWidthClassName}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900" id={titleId}>{title}</h3>
            {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
          </div>
          <button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" type="button" aria-label="关闭" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {children}
        </div>
      </div>
    </div>
  )
}

export function Pagination({
  page,
  pageSize,
  totalItems,
  totalPages,
  onPageChange,
}: {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  onPageChange: (page: number) => void
}) {
  if (totalItems <= pageSize) return null
  const start = (page - 1) * pageSize + 1
  const end = Math.min(totalItems, page * pageSize)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
      <span>{start}-{end} / {totalItems}</span>
      <div className="flex items-center gap-2">
        <Button disabled={page <= 1} onClick={() => onPageChange(page - 1)} variant="secondary" size="sm">
          <ChevronLeft className="size-4" />
          上一页
        </Button>
        <span className="min-w-16 text-center font-semibold text-slate-700">{page} / {totalPages}</span>
        <Button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} variant="secondary" size="sm">
          下一页
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  variant = 'danger',
  disabled = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'primary' | 'danger'
  disabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 px-4 py-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/20" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 rounded-full p-2 ${variant === 'danger' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
            <AlertCircle className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900" id="confirm-dialog-title">{title}</h3>
            {description ? <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p> : null}
          </div>
          <button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" type="button" aria-label="关闭" onClick={onCancel}>
            <X className="size-5" />
          </button>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button disabled={disabled} onClick={onCancel} variant="secondary">{cancelLabel}</Button>
          <Button disabled={disabled} onClick={onConfirm} variant={variant}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}
