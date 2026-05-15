import { Check, ChevronDown, Download, Loader2, Settings } from 'lucide-react'
import { useState } from 'react'
import { Button } from './ui'
import type { DownloadableItem, DownloaderConfig } from '../lib/downloaders'

export function DownloaderSendButton({
  downloaders,
  items,
  menu = true,
  pending = false,
  size = 'sm',
  onDefaultChange,
  onSend,
}: {
  downloaders: DownloaderConfig[]
  items: DownloadableItem[]
  menu?: boolean
  pending?: boolean
  size?: 'sm' | 'md'
  onDefaultChange?: (downloaderId: string) => void
  onSend: (downloader: DownloaderConfig, items: DownloadableItem[]) => void
}) {
  const [open, setOpen] = useState(false)
  const enabled = downloaders.filter((item) => item.enabled && item.rpcUrl.trim())
  const defaultDownloader = enabled.find((item) => item.isDefault) ?? enabled[0] ?? null
  const disabled = pending || items.length === 0 || !defaultDownloader
  const triggerSizeClassName = size === 'md' ? 'min-h-10' : 'min-h-8'
  const label = defaultDownloader
    ? `推送${items.length > 1 ? ` ${items.length} 条` : ''}到 ${defaultDownloader.name}`
    : '推送到下载器'

  return (
    <div className="relative inline-flex">
      <Button
        disabled={disabled}
        onClick={() => {
          if (defaultDownloader) onSend(defaultDownloader, items)
        }}
        size={size}
        variant="secondary"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {label}
      </Button>
      {menu ? (
        <button
          aria-label="选择默认下载器"
          className={`ml-1 inline-flex items-center justify-center rounded-md bg-white px-2 text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${triggerSizeClassName}`}
          disabled={pending}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <ChevronDown className="size-4" />
        </button>
      ) : null}
      {menu && open ? (
        <>
          <button aria-label="关闭下载器菜单" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} type="button" />
          <div className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/10">
            {enabled.length === 0 ? (
              <div className="px-3 py-2 text-sm font-semibold text-slate-500">未配置下载器</div>
            ) : (
              enabled.map((downloader) => (
                <button
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  disabled={pending || downloader.isDefault}
                  key={downloader.id}
                  onClick={() => {
                    setOpen(false)
                    onDefaultChange?.(downloader.id)
                  }}
                  type="button"
                >
                  <span className="min-w-0 flex-1 truncate">{downloader.name}</span>
                  {downloader.isDefault ? <Check className="size-4 text-blue-600" /> : null}
                </button>
              ))
            )}
            <div className="my-1 h-px bg-slate-100" />
            <a
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              href="#/settings?section=downloaders"
              onClick={() => setOpen(false)}
            >
              <Settings className="size-4" />
              下载器设置
            </a>
          </div>
        </>
      ) : null}
    </div>
  )
}
