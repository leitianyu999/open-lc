import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, HelpCircle, LogOut, Loader2, Lock, Plus, RotateCcw, Save, ShieldOff, Trash2 } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { api, clearStoredAgentPassword, getStoredAgentPassword, messageFromError, setStoredAgentPassword, type AgentSetting, type AgentSettings, type DesktopRuntime, type RiskConsentType } from '../api'
import { RiskConsentDialog } from '../components/RiskConsentDialog'
import { Button, ConfirmDialog, MiddleEllipsis, Modal, Panel } from '../components/ui'
import { defaultDownloaderForType, parseDownloaders, serializeDownloaders, type DownloaderConfig, type DownloaderType } from '../lib/downloaders'
import { errorAtom, clearParseExecutionAtom, pushNotificationAtom } from '../state'
import workerSource from '../../../../scripts/worker.js?raw'
import encryptUrlSource from '../../../../scripts/encrypt-url.js?raw'

type SettingsForm = Record<string, string>
type SettingsGroupKey = keyof AgentSettings['groups']
type SettingsCategoryKey = 'security' | 'broker' | 'runtime' | 'advanced' | 'maintenance'
type AdvancedSectionKey = 'baidu' | 'deployment'
type DesktopSwitchOverlay = {
  targetEnabled: boolean
  message: string
} | null
type MaintenanceConfirmTarget = 'cleanup' | 'factory-reset' | null
type MaintenanceSummaryResponse = typeof api.api.maintenance.summary.$get.$infer['data']
type MaintenanceSummary = MaintenanceSummaryResponse['data']
type DownloaderDraft = DownloaderConfig
type PendingRiskConsent = {
  type: RiskConsentType
  afterAccept: () => void
} | null
type WorkerHelpTab = 'worker' | 'encrypt'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const desktopSwitchTimeoutMs = 15_000
const desktopSwitchPollMs = 350
const settingsRowClassName = 'grid gap-2 px-3 py-3 sm:px-4 lg:grid-cols-[minmax(150px,230px)_86px_minmax(180px,400px)_minmax(188px,auto)] lg:items-center'
const settingsInputClassName = 'h-8 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500'
const settingsValueCellClassName = 'w-full min-w-0 lg:max-w-[400px]'
const settingsBadgeCellClassName = 'hidden items-center lg:flex lg:justify-start'
const settingsActionCellClassName = 'grid min-h-8 grid-cols-[repeat(auto-fit,minmax(76px,1fr))] gap-1.5 sm:flex sm:flex-wrap sm:items-center lg:flex-nowrap lg:justify-end'
const settingsActionButtonClassName = 'w-full sm:w-auto'

const groupMeta: Record<SettingsGroupKey, { title: string }> = {
  desktop: {
    title: '桌面端',
  },
  broker: {
    title: 'Broker 连接',
  },
  account: {
    title: '账号策略',
  },
  download: {
    title: '下载与代理',
  },
  parse: {
    title: '解析限制',
  },
  health: {
    title: '健康检查',
  },
  baidu: {
    title: 'Baidu 运行参数',
  },
  deployment: {
    title: '部署只读项',
  },
}

const categoryMeta: Array<{ key: SettingsCategoryKey, title: string }> = [
  { key: 'security', title: '访问与安全' },
  { key: 'broker', title: 'Broker 连接' },
  { key: 'runtime', title: '解析与账号' },
  { key: 'advanced', title: '下载与高级' },
  { key: 'maintenance', title: '数据维护' },
]

const sourceLabel = (source: string) => {
  if (source === 'database') return '页面'
  if (source === 'env') return '环境变量'
  return '默认值'
}

const sourceClassName = (source: string) => {
  if (source === 'database') return 'bg-blue-50 text-blue-700 ring-blue-200'
  if (source === 'env') return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  return 'bg-slate-100 text-slate-600 ring-slate-200'
}

const initialFormFromSettings = (settings: AgentSettings | undefined): SettingsForm => {
  if (!settings) return {}
  const next: SettingsForm = {}
  for (const item of Object.values(settings.items)) {
    if (!item.editable) continue
    next[item.name] = item.sensitive ? '' : item.value
  }
  return next
}

const settingsCount = (settings: AgentSettings | undefined, groups: SettingsGroupKey[]) =>
  groups.reduce((count, group) => count + (settings?.groups[group]?.length ?? 0), 0)

const visibleSettings = (items: AgentSetting[]) =>
  items.filter((item) => item.name !== 'downloadersJson')

const riskConsentTypeForSettingToggle = (
  setting: AgentSetting,
  nextValue: string,
  consents?: Record<RiskConsentType, boolean>,
): RiskConsentType | null => {
  if (nextValue !== 'true') return null
  if (setting.name === 'showCookieAccountAddButton' && !consents?.cookie_account) return 'cookie_account'
  if (setting.name === 'brokerEnabled' && !consents?.broker_execution) return 'broker_execution'
  return null
}

function SourceBadge({ setting }: { setting: AgentSetting }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-md px-2 text-[11px] font-semibold ring-1 ${sourceClassName(setting.source)}`}>
      {sourceLabel(setting.source)}
    </span>
  )
}

function StatusBadge({
  enabled,
  enabledLabel,
  disabledLabel,
}: {
  enabled: boolean
  enabledLabel: string
  disabledLabel: string
}) {
  return (
    <span className={`inline-flex h-6 items-center rounded-md px-2 text-[11px] font-semibold ring-1 ${enabled ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
      {enabled ? enabledLabel : disabledLabel}
    </span>
  )
}

function SettingInput({
  setting,
  value,
  pending,
  saving,
  onChange,
}: {
  setting: AgentSetting
  value: string
  pending: boolean
  saving: boolean
  onChange: (value: string) => void
}) {
  if (setting.type === 'boolean') {
    return (
      <Button
        aria-pressed={value === 'true'}
        className="w-full sm:w-auto"
        disabled={!setting.editable || pending}
        onClick={() => onChange(String(value !== 'true'))}
        size="sm"
        type="button"
        variant={value === 'true' ? 'primary' : 'secondary'}
      >
        {saving ? <Loader2 className="size-4 animate-spin" /> : null}
        {value === 'true' ? '已开启' : '未开启'}
      </Button>
    )
  }

  return (
    <input
      className={settingsInputClassName}
      disabled={!setting.editable}
      max={setting.max}
      min={setting.min}
      onChange={(event) => onChange(event.target.value)}
      placeholder={setting.sensitive ? setting.displayValue : setting.envName}
      type={setting.type === 'number' ? 'number' : setting.sensitive ? 'password' : 'text'}
      value={value}
    />
  )
}

function SettingRow({
  setting,
  form,
  pending,
  savingSettingName,
  rowAction,
  onChange,
  onReset,
  onSave,
}: {
  setting: AgentSetting
  form: SettingsForm
  pending: boolean
  savingSettingName: string | null
  rowAction?: ReactNode
  onChange: (setting: AgentSetting, value: string) => void
  onReset: (setting: AgentSetting) => void
  onSave: (setting: AgentSetting) => void
}) {
  return (
    <div className={settingsRowClassName}>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <div className="min-w-0 truncate text-sm font-semibold text-slate-900">{setting.label}</div>
          {rowAction}
          <span className="lg:hidden">
            <SourceBadge setting={setting} />
          </span>
          {setting.sensitive ? (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">敏感</span>
          ) : null}
          {!setting.editable ? (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">只读</span>
          ) : null}
        </div>
        <MiddleEllipsis text={setting.envName} className="mt-0.5 hidden text-[11px] text-slate-500 sm:block" />
      </div>
      <div className={settingsBadgeCellClassName}>
        <SourceBadge setting={setting} />
      </div>
      <div className={settingsValueCellClassName}>
        <SettingInput
          setting={setting}
          pending={pending}
          saving={pending && savingSettingName === setting.name}
          value={setting.editable ? form[setting.name] ?? '' : setting.value}
          onChange={(value) => onChange(setting, value)}
        />
        {setting.sensitive ? (
          <div className="mt-1 text-[11px] text-slate-500">当前：{setting.displayValue}</div>
        ) : null}
      </div>
      <div className={settingsActionCellClassName}>
        {setting.editable && setting.type !== 'boolean' ? (
          <>
            <Button className={settingsActionButtonClassName} disabled={pending} onClick={() => onSave(setting)} size="sm">
              <Save className="size-4" />
              保存
            </Button>
            <Button className={settingsActionButtonClassName} disabled={pending || setting.source !== 'database'} onClick={() => onReset(setting)} size="sm" variant="secondary">
              <RotateCcw className="size-4" />
              回退
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}

function SectionHeader({
  title,
  count,
  action,
}: {
  title: string
  count: number
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="truncate text-sm font-bold text-slate-900">{title}</h3>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{count}</span>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

function SettingsSection({
  title,
  items,
  form,
  pending,
  savingSettingName,
  collapsed = false,
  collapsible = false,
  onChange,
  onReset,
  onSave,
  onToggle,
  rowActionForSetting,
}: {
  title: string
  items: AgentSetting[]
  form: SettingsForm
  pending: boolean
  savingSettingName: string | null
  collapsed?: boolean
  collapsible?: boolean
  onChange: (setting: AgentSetting, value: string) => void
  onReset: (setting: AgentSetting) => void
  onSave: (setting: AgentSetting) => void
  onToggle?: () => void
  rowActionForSetting?: (setting: AgentSetting) => ReactNode
}) {
  if (items.length === 0) return null

  return (
    <section className="border-t border-slate-200">
      <SectionHeader
        title={title}
        count={items.length}
        action={collapsible ? (
          <Button onClick={onToggle} size="sm" variant="ghost">
            {collapsed ? '展开' : '收起'}
            {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </Button>
        ) : null}
      />
      {collapsed ? null : (
        <div className="divide-y divide-slate-100">
          {items.map((setting) => (
            <SettingRow
              form={form}
              key={setting.key}
              pending={pending}
              rowAction={rowActionForSetting?.(setting)}
              savingSettingName={savingSettingName}
              setting={setting}
              onChange={onChange}
              onReset={onReset}
              onSave={onSave}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-5 text-sm font-semibold text-slate-600 sm:px-4">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  )
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="border-t border-slate-200 px-3 py-8 text-center text-sm font-semibold text-slate-500 sm:px-4">
      {label}
    </div>
  )
}

function WorkerHelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-semibold text-blue-600 transition hover:bg-blue-50 hover:text-blue-700"
      onClick={onClick}
      aria-label="Worker 端点帮助"
      type="button"
    >
      <HelpCircle className="size-4" />
      这是什么？
    </button>
  )
}

function WorkerHelpModal({
  open,
  activeTab,
  onTabChange,
  onClose,
}: {
  open: boolean
  activeTab: WorkerHelpTab
  onTabChange: (tab: WorkerHelpTab) => void
  onClose: () => void
}) {
  const tabs: Array<{ key: WorkerHelpTab, label: string, filename: string, source: string }> = [
    { key: 'worker', label: 'Worker 代理脚本', filename: 'scripts/worker.js', source: workerSource },
    { key: 'encrypt', label: '本地加密示例', filename: 'scripts/encrypt-url.js', source: encryptUrlSource },
  ]
  const current = tabs.find((tab) => tab.key === activeTab) ?? tabs[0]

  return (
    <Modal open={open} title="Worker 端点帮助" onClose={onClose} maxWidthClassName="max-w-5xl">
      <div className="grid gap-5">
        <div className="grid gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-4 text-sm leading-6 text-blue-900">
          <p className="font-semibold">解析出的下载链接可能包含私密令牌。直接暴露真实链接，等同于交出资源访问权，可能带来不必要的损失。</p>
          <p>Worker 端点用于接收加密后的 token，再由 Worker 解密并代理真实下载链接。这样外部只会看到代理地址，不会直接看到原始直链。</p>
        </div>
        <div className="grid gap-3 text-sm text-slate-700 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="font-bold text-slate-900">Worker 端点</div>
            <div className="mt-1 leading-6">填写部署后的 Worker 公开地址，用于生成代理下载入口。</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="font-bold text-slate-900">Worker 加密密钥</div>
            <div className="mt-1 leading-6">必须和 Worker 环境变量 <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-slate-800">URL_ENCRYPTION_KEY</code> 保持一致。</div>
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex flex-wrap gap-1 rounded-lg bg-slate-200/70 p-1">
              {tabs.map((tab) => (
                <button
                  className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${activeTab === tab.key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  key={tab.key}
                  onClick={() => onTabChange(tab.key)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <span className="rounded-md bg-white px-2 py-1 font-mono text-xs font-semibold text-slate-500 ring-1 ring-slate-200">{current.filename}</span>
          </div>
          <pre className="max-h-[54vh] overflow-auto bg-slate-950 px-4 py-4 text-xs leading-5 text-slate-100">
            <code>{current.source}</code>
          </pre>
        </div>
      </div>
    </Modal>
  )
}

function PasswordAccessSection({
  passwordEnabled,
  loading,
  password,
  pending,
  onPasswordChange,
  onSubmit,
  onLogout,
  onDisable,
}: {
  passwordEnabled: boolean
  loading: boolean
  password: string
  pending: boolean
  onPasswordChange: (password: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onLogout: () => void
  onDisable: () => void
}) {
  return (
    <section className="border-t border-slate-200">
      <SectionHeader title="访问密码" count={1} />
      {loading ? (
        <LoadingBlock label="正在读取访问设置" />
      ) : (
        <form onSubmit={onSubmit}>
          <div className={settingsRowClassName}>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <div className="min-w-0 truncate text-sm font-semibold text-slate-900">页面访问</div>
                <span className="lg:hidden">
                  <StatusBadge enabled={passwordEnabled} enabledLabel="保护中" disabledLabel="开放" />
                </span>
              </div>
            </div>
            <div className={settingsBadgeCellClassName}>
              <StatusBadge enabled={passwordEnabled} enabledLabel="保护中" disabledLabel="开放" />
            </div>
            <div className={settingsValueCellClassName}>
              <input
                className={settingsInputClassName}
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                placeholder={passwordEnabled ? '输入新密码' : '输入密码'}
                type="password"
              />
            </div>
            <div className={settingsActionCellClassName}>
              <Button className={settingsActionButtonClassName} disabled={pending || !password.trim()} size="sm" type="submit">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
                {passwordEnabled ? '更新' : '开启'}
              </Button>
              {passwordEnabled ? (
                <>
                  <Button className={settingsActionButtonClassName} disabled={pending} onClick={onLogout} size="sm" variant="secondary">
                    <LogOut className="size-4" />
                    退出
                  </Button>
                  <Button className={settingsActionButtonClassName} disabled={pending} onClick={onDisable} size="sm" variant="secondary">
                    <ShieldOff className="size-4" />
                    关闭
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </form>
      )}
    </section>
  )
}

function DesktopAccessSection({
  runtime,
  pending,
  opening,
  onToggle,
  onOpenBrowser,
}: {
  runtime: DesktopRuntime
  pending: boolean
  opening: boolean
  onToggle: (enabled: boolean) => void
  onOpenBrowser: () => void
}) {
  const enabled = runtime.externalAccessEnabled

  return (
    <section className="border-t border-slate-200">
      <SectionHeader title="桌面访问" count={1} />
      <div className={settingsRowClassName}>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <div className="min-w-0 truncate text-sm font-semibold text-slate-900">外部访问</div>
            <span className="lg:hidden">
              <StatusBadge enabled={enabled} enabledLabel="外部" disabledLabel="本机" />
            </span>
            {runtime.restartPending ? (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">切换中</span>
            ) : null}
          </div>
        </div>
        <div className={settingsBadgeCellClassName}>
          <StatusBadge enabled={enabled} enabledLabel="外部" disabledLabel="本机" />
        </div>
        <div className={`${settingsValueCellClassName} flex min-h-8 items-center`}>
          <Button
            className="w-full sm:w-auto"
            disabled={pending || runtime.restartPending}
            onClick={() => onToggle(!enabled)}
            size="sm"
            variant={enabled ? 'secondary' : 'primary'}
          >
            {pending || runtime.restartPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {enabled ? '关闭外部访问' : '开启外部访问'}
          </Button>
        </div>
        <div className={settingsActionCellClassName}>
          <Button
            className={settingsActionButtonClassName}
            disabled={pending || opening || runtime.restartPending || (!runtime.primaryExternalUrl && !runtime.localUrl)}
            onClick={onOpenBrowser}
            size="sm"
            variant="secondary"
          >
            {opening ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
            打开浏览器
          </Button>
        </div>
      </div>
    </section>
  )
}

function DesktopSwitchLoading({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-4 text-slate-900">
      <div className="flex w-full max-w-xs items-center gap-3 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-xl shadow-slate-900/20">
        <Loader2 className="size-5 shrink-0 animate-spin text-blue-600" />
        <div className="min-w-0 text-sm font-semibold text-slate-800">{message}</div>
      </div>
    </div>
  )
}

function DownloadersSection({
  downloaders,
  pending,
  onChange,
  onSave,
}: {
  downloaders: DownloaderDraft[]
  pending: boolean
  onChange: (downloaders: DownloaderDraft[]) => void
  onSave: () => void
}) {
  const addDownloader = (type: DownloaderType) => {
    const next = defaultDownloaderForType(type)
    onChange([
      ...downloaders.map((item) => ({ ...item, isDefault: downloaders.length === 0 ? false : item.isDefault })),
      { ...next, isDefault: downloaders.length === 0 },
    ])
  }
  const updateDownloader = (id: string, patch: Partial<DownloaderDraft>) => {
    onChange(downloaders.map((item) => {
      if (item.id !== id) return item
      const updated = { ...item, ...patch }
      if (patch.type) {
        const fallback = defaultDownloaderForType(patch.type)
        updated.rpcUrl = item.rpcUrl === defaultDownloaderForType(item.type).rpcUrl ? fallback.rpcUrl : item.rpcUrl
        updated.name = item.name === defaultDownloaderForType(item.type).name ? fallback.name : item.name
      }
      return updated
    }))
  }
  const removeDownloader = (id: string) => {
    const next = downloaders.filter((item) => item.id !== id)
    if (next.length > 0 && !next.some((item) => item.isDefault)) next[0] = { ...next[0], isDefault: true }
    onChange(next)
  }
  const setDefault = (id: string) => {
    onChange(downloaders.map((item) => ({ ...item, isDefault: item.id === id })))
  }

  return (
    <section className="border-t border-slate-200">
      <SectionHeader
        title="下载器"
        count={downloaders.length}
        action={(
          <div className="flex gap-1.5">
            <Button disabled={pending} onClick={() => addDownloader('motrix')} size="sm" variant="secondary">
              <Plus className="size-4" />
              Motrix
            </Button>
            <Button disabled={pending} onClick={() => addDownloader('aria2')} size="sm" variant="secondary">
              <Plus className="size-4" />
              aria2
            </Button>
          </div>
        )}
      />
      <div className="grid gap-3 px-3 py-3 sm:px-4">
        {downloaders.length === 0 ? (
          <div className="rounded-md bg-slate-50 px-3 py-5 text-center text-sm font-semibold text-slate-500">未配置下载器</div>
        ) : (
          downloaders.map((downloader) => (
            <div className="grid gap-3 rounded-lg border border-slate-200 p-3" key={downloader.id}>
              <div className="grid gap-2 md:grid-cols-[120px_minmax(120px,1fr)_minmax(200px,2fr)]">
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  类型
                  <select
                    className={settingsInputClassName}
                    value={downloader.type}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) => updateDownloader(downloader.id, { type: event.target.value === 'aria2' ? 'aria2' : 'motrix' })}
                  >
                    <option value="motrix">Motrix</option>
                    <option value="aria2">aria2</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  名称
                  <input className={settingsInputClassName} value={downloader.name} onChange={(event) => updateDownloader(downloader.id, { name: event.target.value })} />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  RPC URL
                  <input className={settingsInputClassName} value={downloader.rpcUrl} onChange={(event) => updateDownloader(downloader.id, { rpcUrl: event.target.value })} />
                </label>
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(120px,1fr)_minmax(120px,1fr)]">
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Token
                  <input className={settingsInputClassName} value={downloader.token} onChange={(event) => updateDownloader(downloader.id, { token: event.target.value })} />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  下载目录
                  <input className={settingsInputClassName} value={downloader.downloadDir} onChange={(event) => updateDownloader(downloader.id, { downloadDir: event.target.value })} />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={pending} onClick={() => updateDownloader(downloader.id, { enabled: !downloader.enabled })} size="sm" variant={downloader.enabled ? 'primary' : 'secondary'}>
                  {downloader.enabled ? '已启用' : '未启用'}
                </Button>
                <Button disabled={pending || downloader.isDefault} onClick={() => setDefault(downloader.id)} size="sm" variant={downloader.isDefault ? 'primary' : 'secondary'}>
                  {downloader.isDefault ? '默认' : '设为默认'}
                </Button>
                <Button disabled={pending} onClick={() => removeDownloader(downloader.id)} size="sm" variant="danger">
                  <Trash2 className="size-4" />
                  删除
                </Button>
              </div>
            </div>
          ))
        )}
        <div className="flex justify-end">
          <Button disabled={pending} onClick={onSave} size="sm">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存下载器
          </Button>
        </div>
      </div>
    </section>
  )
}

function MaintenanceSection({
  summary,
  loading,
  pending,
  onRefresh,
  onCleanup,
  onFactoryReset,
}: {
  summary?: MaintenanceSummary
  loading: boolean
  pending: boolean
  onRefresh: () => void
  onCleanup: () => void
  onFactoryReset: () => void
}) {
  if (loading) return <LoadingBlock label="正在读取维护状态" />

  const runtimeCount = summary
    ? summary.parseJobs + summary.parseRecords + summary.parseEvents + summary.baiduTempFiles + summary.accountEvents + summary.brokerRuns + summary.brokerRunEvents
    : 0
  const factoryCount = summary ? runtimeCount + summary.baiduAccounts + summary.appSettings : runtimeCount
  const activeCount = summary ? summary.activeParseJobs + summary.activeBrokerRuns : 0
  const parseRunning = (summary?.activeParseJobs ?? 0) > 0

  return (
    <>
      <section className="border-t border-slate-200">
        <SectionHeader
          title="维护状态"
          count={activeCount}
          action={(
            <Button disabled={pending} onClick={onRefresh} size="sm" variant="secondary">
              <RotateCcw className="size-4" />
              刷新
            </Button>
          )}
        />
        <div className="grid gap-2 px-3 py-3 sm:grid-cols-2 sm:px-4 lg:grid-cols-4">
          <Metric label="运行数据" value={runtimeCount} />
          <Metric label="恢复出厂项" value={factoryCount} />
          <Metric label="解析运行中" value={summary?.activeParseJobs ?? 0} />
          <Metric label="Broker 运行中" value={summary?.activeBrokerRuns ?? 0} />
        </div>
      </section>
      <section className="border-t border-slate-200">
        <SectionHeader title="危险操作" count={2} />
        <div className="divide-y divide-slate-100">
          <MaintenanceActionRow
            actionLabel="清理"
            count={runtimeCount}
            disabled={pending || parseRunning}
            label="清理运行数据"
            pending={pending}
            variant="secondary"
            onAction={onCleanup}
          />
          <MaintenanceActionRow
            actionLabel="恢复出厂"
            count={factoryCount}
            disabled={pending || parseRunning}
            label="恢复出厂"
            pending={pending}
            variant="danger"
            onAction={onFactoryReset}
          />
        </div>
      </section>
    </>
  )
}

function Metric({ label, value }: { label: string, value: number }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-slate-900">{value}</div>
    </div>
  )
}

function MaintenanceActionRow({
  label,
  count,
  actionLabel,
  variant,
  pending,
  disabled,
  onAction,
}: {
  label: string
  count: number
  actionLabel: string
  variant: 'secondary' | 'danger'
  pending: boolean
  disabled: boolean
  onAction: () => void
}) {
  return (
    <div className={settingsRowClassName}>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <div className="min-w-0 truncate text-sm font-semibold text-slate-900">{label}</div>
          <span className="lg:hidden">
            <StatusBadge enabled={count > 0} enabledLabel={`${count} 项`} disabledLabel="空" />
          </span>
        </div>
      </div>
      <div className={settingsBadgeCellClassName}>
        <StatusBadge enabled={count > 0} enabledLabel={`${count} 项`} disabledLabel="空" />
      </div>
      <div className={`${settingsValueCellClassName} flex min-h-8 items-center`} />
      <div className={settingsActionCellClassName}>
        <Button className={settingsActionButtonClassName} disabled={disabled} onClick={onAction} size="sm" variant={variant}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          {actionLabel}
        </Button>
      </div>
    </div>
  )
}

function FactoryResetDialog({
  open,
  confirmText,
  disabled,
  onChange,
  onConfirm,
  onCancel,
}: {
  open: boolean
  confirmText: string
  disabled: boolean
  onChange: (value: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  const confirmed = confirmText.trim() === 'RESET'
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 px-4 py-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/20" role="dialog" aria-modal="true" aria-labelledby="factory-reset-dialog-title">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-red-50 p-2 text-red-600">
            <Trash2 className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900" id="factory-reset-dialog-title">恢复出厂</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">将删除账号、Broker 配置、访问密码和历史。输入 RESET 确认。</p>
            <input
              autoFocus
              className={`${settingsInputClassName} mt-3`}
              onChange={(event) => onChange(event.target.value)}
              placeholder="RESET"
              value={confirmText}
            />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button disabled={disabled} onClick={onCancel} variant="secondary">取消</Button>
          <Button disabled={disabled || !confirmed} onClick={onConfirm} variant="danger">
            {disabled ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            恢复出厂
          </Button>
        </div>
      </div>
    </div>
  )
}

export function SettingsPage() {
  const clearParseExecution = useSetAtom(clearParseExecutionAtom)
  const pushNotification = useSetAtom(pushNotificationAtom)
  const setError = useSetAtom(errorAtom)
  const statusQuery = api.api.security.status.$get.useQuery()
  const agentSettingsQuery = api.api.settings.$get.useQuery()
  const desktopRuntimeQuery = api.api.desktop.runtime.$get.useQuery()
  const maintenanceSummaryQuery = api.api.maintenance.summary.$get.useQuery()
  const securityMutation = api.api.security.settings.$put.useMutation()
  const agentSettingsMutation = api.api.settings.$put.useMutation()
  const desktopAccessMutation = api.api.desktop['external-access'].$put.useMutation()
  const desktopOpenBrowserMutation = api.api.desktop['open-external-browser'].$post.useMutation()
  const maintenanceCleanupMutation = api.api.maintenance.cleanup.$post.useMutation()
  const maintenanceFactoryResetMutation = api.api.maintenance['factory-reset'].$post.useMutation()
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryKey>('security')
  const [advancedOpen, setAdvancedOpen] = useState<Record<AdvancedSectionKey, boolean>>({
    baidu: false,
    deployment: false,
  })
  const [password, setPassword] = useState('')
  const [form, setForm] = useState<SettingsForm>({})
  const [savingSettingName, setSavingSettingName] = useState<string | null>(null)
  const [settingsQueryErrorDismissed, setSettingsQueryErrorDismissed] = useState(false)
  const [confirmExternalAccess, setConfirmExternalAccess] = useState(false)
  const [maintenanceConfirm, setMaintenanceConfirm] = useState<MaintenanceConfirmTarget>(null)
  const [factoryResetConfirmText, setFactoryResetConfirmText] = useState('')
  const [desktopSwitchOverlay, setDesktopSwitchOverlay] = useState<DesktopSwitchOverlay>(null)
  const [downloadersDraft, setDownloadersDraft] = useState<DownloaderDraft[]>([])
  const [pendingRiskConsent, setPendingRiskConsent] = useState<PendingRiskConsent>(null)
  const [workerHelpOpen, setWorkerHelpOpen] = useState(false)
  const [workerHelpTab, setWorkerHelpTab] = useState<WorkerHelpTab>('worker')
  const passwordEnabled = statusQuery.data?.data.passwordEnabled === true
  const settings = agentSettingsQuery.data?.data
  const desktopRuntime = desktopRuntimeQuery.data?.data
  const desktopMode = desktopRuntime?.desktopMode === true
  const maintenanceSummary = maintenanceSummaryQuery.data?.data
  const maintenancePending = maintenanceCleanupMutation.isPending || maintenanceFactoryResetMutation.isPending
  const settingsQueryError = agentSettingsQuery.isError && !settingsQueryErrorDismissed ? messageFromError(agentSettingsQuery.error, '读取 Agent 配置失败') : null

  useEffect(() => {
    if (!passwordEnabled) return
    setPassword(getStoredAgentPassword())
  }, [passwordEnabled])

  useEffect(() => {
    setForm(initialFormFromSettings(settings))
    setDownloadersDraft(parseDownloaders(settings?.items.downloadersJson?.value))
  }, [settings])

  useEffect(() => {
    if (window.location.hash.includes('section=downloaders')) setActiveCategory('advanced')
  }, [])

  useEffect(() => {
    if (agentSettingsQuery.isError) setSettingsQueryErrorDismissed(false)
  }, [agentSettingsQuery.error])

  useEffect(() => {
    if (!settingsQueryError) return
    pushNotification({
      variant: 'error',
      message: settingsQueryError,
    })
    setSettingsQueryErrorDismissed(true)
  }, [settingsQueryError, pushNotification])

  const categories = useMemo(() => categoryMeta.map((category) => {
    const count = category.key === 'security'
      ? 1 + (desktopMode ? 1 : 0)
      : category.key === 'broker'
        ? settingsCount(settings, ['broker'])
        : category.key === 'runtime'
          ? settingsCount(settings, ['account', 'parse', 'health'])
          : category.key === 'advanced'
            ? visibleSettings(settings?.groups.download ?? []).length + settingsCount(settings, ['baidu', 'deployment'])
            : 2

    return {
      ...category,
      count,
    }
  }), [desktopMode, settings])

  const activeCategoryMeta = categories.find((category) => category.key === activeCategory) ?? categories[0]

  const saveEnabled = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    try {
      await securityMutation.mutateAsync({
        json: {
          enabled: true,
          password,
        },
      })
      setStoredAgentPassword(password)
      await statusQuery.refetch()
      pushNotification({
        variant: 'success',
        message: passwordEnabled ? '访问密码已更新' : '访问密码保护已开启',
      })
    } catch (err) {
      setError(messageFromError(err, '保存访问设置失败'))
    }
  }

  const disablePassword = async () => {
    setError(null)
    try {
      await securityMutation.mutateAsync({
        json: {
          enabled: false,
        },
      })
      clearStoredAgentPassword()
      setPassword('')
      await statusQuery.refetch()
      pushNotification({
        variant: 'success',
        message: '访问密码保护已关闭',
      })
    } catch (err) {
      setError(messageFromError(err, '关闭访问保护失败'))
    }
  }

  const logout = () => {
    clearStoredAgentPassword()
    window.location.reload()
  }

  const updateSettingValue = (setting: AgentSetting, value: string) => {
    if (setting.type === 'boolean') {
      const consentType = riskConsentTypeForSettingToggle(setting, value, statusQuery.data?.data.riskConsents)
      if (consentType) {
        setPendingRiskConsent({
          type: consentType,
          afterAccept: () => void saveBooleanSetting(setting, value),
        })
        return
      }
      void saveBooleanSetting(setting, value)
      return
    }
    setForm((current) => ({ ...current, [setting.name]: value }))
  }

  const rowActionForSetting = (setting: AgentSetting) => {
    if (setting.name !== 'linkProxyBaseUrl') return null
    return <WorkerHelpButton onClick={() => setWorkerHelpOpen(true)} />
  }

  const saveBooleanSetting = async (setting: AgentSetting, value: string) => {
    setError(null)
    setSavingSettingName(setting.name)
    setForm((current) => ({ ...current, [setting.name]: value }))
    try {
      await agentSettingsMutation.mutateAsync({
        json: {
          values: {
            [setting.name]: value,
          },
        },
      })
      await Promise.all([
        agentSettingsQuery.refetch(),
        setting.name === 'brokerEnabled' ? api.api.settings.$get.invalidate() : Promise.resolve(),
      ])
      pushNotification({
        variant: 'success',
        message: `${setting.label} 已保存`,
      })
    } catch (err) {
      setError(messageFromError(err, `保存 ${setting.label} 失败`))
      await agentSettingsQuery.refetch()
    } finally {
      setSavingSettingName((current) => current === setting.name ? null : current)
    }
  }

  const saveSetting = async (setting: AgentSetting) => {
    setError(null)
    try {
      await agentSettingsMutation.mutateAsync({
        json: {
          values: {
            [setting.name]: form[setting.name] ?? '',
          },
        },
      })
      await agentSettingsQuery.refetch()
      pushNotification({
        variant: 'success',
        message: `${setting.label} 已保存`,
      })
    } catch (err) {
      setError(messageFromError(err, `保存 ${setting.label} 失败`))
    }
  }

  const resetSetting = async (setting: AgentSetting) => {
    setError(null)
    try {
      await agentSettingsMutation.mutateAsync({
        json: {
          values: {
            [setting.name]: '',
          },
        },
      })
      await agentSettingsQuery.refetch()
      pushNotification({
        variant: 'success',
        message: `${setting.label} 已回退到环境变量或默认值`,
      })
    } catch (err) {
      setError(messageFromError(err, `回退 ${setting.label} 失败`))
    }
  }

  const saveDownloaders = async () => {
    setError(null)
    try {
      await agentSettingsMutation.mutateAsync({
        json: {
          values: {
            downloadersJson: serializeDownloaders(downloadersDraft),
          },
        },
      })
      await agentSettingsQuery.refetch()
      pushNotification({
        variant: 'success',
        message: '下载器已保存',
      })
    } catch (err) {
      setError(messageFromError(err, '保存下载器失败'))
    }
  }

  const waitForHealth = async () => {
    const deadline = Date.now() + desktopSwitchTimeoutMs
    while (Date.now() < deadline) {
      try {
        const response = await fetch('/health', {
          cache: 'no-store',
          credentials: 'include',
        })
        if (response.ok) return
      } catch {
        // The listener can briefly disappear while Bun restarts the socket.
      }
      await sleep(desktopSwitchPollMs)
    }
    throw new Error('桌面监听启动超时')
  }

  const waitForDesktopRuntime = async (targetEnabled: boolean) => {
    const deadline = Date.now() + desktopSwitchTimeoutMs
    const targetHost = targetEnabled ? '0.0.0.0' : '127.0.0.1'
    while (Date.now() < deadline) {
      try {
        const result = await desktopRuntimeQuery.refetch()
        const runtime = result.data?.data
        if (runtime?.lastSwitchError) throw new Error(runtime.lastSwitchError)
        if (runtime && !runtime.restartPending && runtime.externalAccessEnabled === targetEnabled && runtime.bindHost === targetHost) {
          return runtime
        }
      } catch (err) {
        if (err instanceof Error && err.message !== 'Failed to fetch') throw err
      }
      await sleep(desktopSwitchPollMs)
    }
    throw new Error('桌面监听状态确认超时')
  }

  const saveDesktopAccess = async (enabled: boolean) => {
    setError(null)
    setDesktopSwitchOverlay({
      targetEnabled: enabled,
      message: enabled ? '正在开启外部访问' : '正在关闭外部访问',
    })
    try {
      await desktopAccessMutation.mutateAsync({
        json: { enabled },
      })
      setDesktopSwitchOverlay({
        targetEnabled: enabled,
        message: '正在等待桌面监听启动',
      })
      await waitForHealth()
      setDesktopSwitchOverlay({
        targetEnabled: enabled,
        message: '正在确认桌面监听状态',
      })
      await waitForDesktopRuntime(enabled)
      await agentSettingsQuery.refetch()
      window.location.reload()
    } catch (err) {
      setError(messageFromError(err, enabled ? '开启桌面外部访问失败' : '关闭桌面外部访问失败'))
      setDesktopSwitchOverlay(null)
    }
  }

  const toggleDesktopAccess = (enabled: boolean) => {
    if (enabled) {
      setConfirmExternalAccess(true)
      return
    }
    void saveDesktopAccess(false)
  }

  const openExternalBrowser = async () => {
    setError(null)
    try {
      await desktopOpenBrowserMutation.mutateAsync({ json: {} })
      pushNotification({
        variant: 'success',
        message: '已打开外部浏览器',
      })
    } catch (err) {
      setError(messageFromError(err, '打开外部浏览器失败'))
    }
  }

  const toggleAdvancedSection = (key: AdvancedSectionKey) => {
    setAdvancedOpen((current) => ({ ...current, [key]: !current[key] }))
  }

  const switchCategory = (category: SettingsCategoryKey) => {
    setActiveCategory(category)
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'auto' })
  }

  const refreshMaintenanceSummary = () => {
    void maintenanceSummaryQuery.refetch()
  }

  const cleanupRuntime = async () => {
    setError(null)
    try {
      await maintenanceCleanupMutation.mutateAsync({ json: {} })
      clearParseExecution()
      await Promise.all([
        maintenanceSummaryQuery.refetch(),
        agentSettingsQuery.refetch(),
        desktopRuntimeQuery.refetch(),
      ])
      pushNotification({
        variant: 'success',
        message: '运行数据已清理',
      })
    } catch (err) {
      setError(messageFromError(err, '清理运行数据失败'))
    } finally {
      setMaintenanceConfirm(null)
    }
  }

  const factoryReset = async () => {
    setError(null)
    try {
      await maintenanceFactoryResetMutation.mutateAsync({ json: {} })
      clearParseExecution()
      clearStoredAgentPassword()
      setPassword('')
      setMaintenanceConfirm(null)
      window.location.reload()
    } catch (err) {
      setError(messageFromError(err, '恢复出厂失败'))
      setMaintenanceConfirm(null)
    }
  }

  const renderSettingsContent = () => {
    if (activeCategory === 'maintenance') {
      return (
        <MaintenanceSection
          loading={maintenanceSummaryQuery.isLoading}
          pending={maintenancePending}
          summary={maintenanceSummary}
          onCleanup={() => setMaintenanceConfirm('cleanup')}
          onFactoryReset={() => {
            setFactoryResetConfirmText('')
            setMaintenanceConfirm('factory-reset')
          }}
          onRefresh={refreshMaintenanceSummary}
        />
      )
    }

    if (activeCategory !== 'security') {
      if (agentSettingsQuery.isLoading) return <LoadingBlock label="正在读取 Agent 配置" />
      if (!settings || agentSettingsQuery.isError) return <EmptyBlock label="配置不可用" />
    }

    if (activeCategory === 'security') {
      return (
        <>
          <PasswordAccessSection
            loading={statusQuery.isLoading}
            password={password}
            passwordEnabled={passwordEnabled}
            pending={securityMutation.isPending}
            onDisable={disablePassword}
            onLogout={logout}
            onPasswordChange={setPassword}
            onSubmit={saveEnabled}
          />
          {desktopMode && desktopRuntime ? (
            <DesktopAccessSection
              opening={desktopOpenBrowserMutation.isPending}
              pending={desktopAccessMutation.isPending}
              runtime={desktopRuntime}
              onOpenBrowser={openExternalBrowser}
              onToggle={toggleDesktopAccess}
            />
          ) : null}
        </>
      )
    }

    if (!settings) return <EmptyBlock label="配置不可用" />

    if (activeCategory === 'broker') {
      return (
        <SettingsSection
          form={form}
          items={settings.groups.broker}
          pending={agentSettingsMutation.isPending}
          savingSettingName={savingSettingName}
          title={groupMeta.broker.title}
          onChange={updateSettingValue}
          onReset={resetSetting}
          onSave={saveSetting}
        />
      )
    }

    if (activeCategory === 'runtime') {
      return (
        <>
          <SettingsSection
            form={form}
            items={settings.groups.account}
            pending={agentSettingsMutation.isPending}
            savingSettingName={savingSettingName}
            title={groupMeta.account.title}
            onChange={updateSettingValue}
            onReset={resetSetting}
            onSave={saveSetting}
          />
          <SettingsSection
            form={form}
            items={settings.groups.parse}
            pending={agentSettingsMutation.isPending}
            savingSettingName={savingSettingName}
            title={groupMeta.parse.title}
            onChange={updateSettingValue}
            onReset={resetSetting}
            onSave={saveSetting}
          />
          <SettingsSection
            form={form}
            items={settings.groups.health}
            pending={agentSettingsMutation.isPending}
            savingSettingName={savingSettingName}
            title={groupMeta.health.title}
            onChange={updateSettingValue}
            onReset={resetSetting}
            onSave={saveSetting}
          />
        </>
      )
    }

    return (
      <>
        <SettingsSection
          form={form}
          items={visibleSettings(settings.groups.download)}
          pending={agentSettingsMutation.isPending}
          savingSettingName={savingSettingName}
          title={groupMeta.download.title}
          onChange={updateSettingValue}
          onReset={resetSetting}
          onSave={saveSetting}
          rowActionForSetting={rowActionForSetting}
        />
        <DownloadersSection
          downloaders={downloadersDraft}
          pending={agentSettingsMutation.isPending}
          onChange={setDownloadersDraft}
          onSave={saveDownloaders}
        />
        <SettingsSection
          collapsed={!advancedOpen.baidu}
          collapsible
          form={form}
          items={settings.groups.baidu}
          pending={agentSettingsMutation.isPending}
          savingSettingName={savingSettingName}
          title={groupMeta.baidu.title}
          onChange={updateSettingValue}
          onReset={resetSetting}
          onSave={saveSetting}
          onToggle={() => toggleAdvancedSection('baidu')}
        />
        <SettingsSection
          collapsed={!advancedOpen.deployment}
          collapsible
          form={form}
          items={settings.groups.deployment}
          pending={agentSettingsMutation.isPending}
          savingSettingName={savingSettingName}
          title={groupMeta.deployment.title}
          onChange={updateSettingValue}
          onReset={resetSetting}
          onSave={saveSetting}
          onToggle={() => toggleAdvancedSection('deployment')}
        />
      </>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
        <Panel className="!p-1.5 lg:sticky lg:top-4">
          <div className="grid gap-0.5">
            {categories.map((category) => {
              const active = category.key === activeCategory
              return (
                <button
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex min-h-9 min-w-0 items-center rounded-md px-4 py-2 text-left text-sm font-semibold ring-1 transition before:absolute before:left-1.5 before:bottom-2 before:top-2 before:w-0.5 before:rounded-full ${active ? 'bg-blue-50 text-blue-700 ring-blue-100 before:bg-blue-600' : 'text-slate-600 ring-transparent before:bg-transparent hover:bg-slate-50 hover:text-slate-900'}`}
                  key={category.key}
                  onClick={() => switchCategory(category.key)}
                  type="button"
                >
                  <span className="truncate">{category.title}</span>
                </button>
              )
            })}
          </div>
        </Panel>

        <Panel className="overflow-hidden !p-0">
          <div className="flex min-h-14 items-center px-3 py-3 sm:px-5 sm:py-4">
            <h2 className="min-w-0 truncate text-base font-bold text-slate-900 sm:text-lg">{activeCategoryMeta.title}</h2>
          </div>

          {renderSettingsContent()}
        </Panel>
      </div>

      <ConfirmDialog
        confirmLabel="开启"
        description="开启后会监听 0.0.0.0，同局域网设备可访问此 Agent。"
        disabled={desktopAccessMutation.isPending}
        open={confirmExternalAccess}
        title="开启外部访问"
        variant="primary"
        onCancel={() => setConfirmExternalAccess(false)}
        onConfirm={() => {
          setConfirmExternalAccess(false)
          void saveDesktopAccess(true)
        }}
      />
      <ConfirmDialog
        confirmLabel="清理"
        description="将删除解析历史、事件日志和 Broker 执行记录，账号与设置会保留。"
        disabled={maintenancePending}
        open={maintenanceConfirm === 'cleanup'}
        title="清理运行数据"
        onCancel={() => setMaintenanceConfirm(null)}
        onConfirm={() => {
          void cleanupRuntime()
        }}
      />
      <FactoryResetDialog
        confirmText={factoryResetConfirmText}
        disabled={maintenancePending}
        open={maintenanceConfirm === 'factory-reset'}
        onCancel={() => setMaintenanceConfirm(null)}
        onChange={setFactoryResetConfirmText}
        onConfirm={() => {
          void factoryReset()
        }}
      />
      <RiskConsentDialog
        open={pendingRiskConsent !== null}
        type={pendingRiskConsent?.type ?? null}
        onAccepted={() => {
          const afterAccept = pendingRiskConsent?.afterAccept
          setPendingRiskConsent(null)
          afterAccept?.()
        }}
        onCancel={() => setPendingRiskConsent(null)}
      />
      <WorkerHelpModal
        activeTab={workerHelpTab}
        open={workerHelpOpen}
        onClose={() => setWorkerHelpOpen(false)}
        onTabChange={setWorkerHelpTab}
      />
      {desktopSwitchOverlay ? <DesktopSwitchLoading message={desktopSwitchOverlay.message} /> : null}
    </div>
  )
}
