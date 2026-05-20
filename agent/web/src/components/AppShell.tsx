import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useSetAtom } from 'jotai'
import { AlertCircle, Bot, Database, History, LayoutDashboard, Loader2, Lock, Settings } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { api, clearStoredAgentPassword, getStoredAgentPassword, messageFromError, setStoredAgentPassword } from '../api'
import { clearNotificationsAtom } from '../state'
import { agentVersion } from '../version'
import { NotificationCenter } from './Common'
import { Button, InlineAlert, Input } from './ui'

const appIconSrc = '/icon.png'

const navItems = [
  { to: '/', label: '工作台', icon: LayoutDashboard },
  { to: '/accounts', label: '账号', icon: Database },
  { to: '/history', label: '历史', icon: History },
  { to: '/broker', label: 'Broker 执行', icon: Bot, feature: 'broker' },
  { to: '/settings', label: '设置', icon: Settings },
] as const

export function AppShell() {
  const { pathname } = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
    }),
  })
  const mainRef = useRef<HTMLElement | null>(null)
  const clearNotifications = useSetAtom(clearNotificationsAtom)
  const [unlocked, setUnlocked] = useState(false)
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const statusQuery = api.api.security.status.$get.useQuery()
  const agentSettingsQuery = api.api.settings.$get.useQuery({
    enabled: unlocked,
  })
  const loginMutation = api.api.security.login.$post.useMutation()
  const passwordEnabled = statusQuery.data?.data.passwordEnabled === true
  const brokerEnabledSetting = agentSettingsQuery.data?.data.items.brokerEnabled
  const showBrokerNav = !brokerEnabledSetting || brokerEnabledSetting.value === 'true'
  const visibleNavItems = navItems.filter((item) => !('feature' in item) || item.feature !== 'broker' || showBrokerNav)

  useLayoutEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    clearNotifications()
  }, [clearNotifications, pathname])

  useEffect(() => {
    if (!statusQuery.data) return
    if (!statusQuery.data.data.passwordEnabled) {
      setUnlocked(true)
      return
    }
    const stored = getStoredAgentPassword()
    if (!stored) return
    loginMutation.mutate(
      { json: { password: stored } },
      {
        onSuccess: () => {
          setUnlocked(true)
          setLoginError(null)
        },
        onError: () => {
          clearStoredAgentPassword()
          setUnlocked(false)
        },
      },
    )
  }, [statusQuery.data])

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginError(null)
    try {
      await loginMutation.mutateAsync({ json: { password } })
      setStoredAgentPassword(password)
      setUnlocked(true)
      setPassword('')
    } catch (error) {
      clearStoredAgentPassword()
      setLoginError(messageFromError(error, '密码不正确'))
    }
  }

  if (statusQuery.isLoading || (passwordEnabled && loginMutation.isPending && !unlocked)) {
    return <SecurityLoading />
  }

  if (statusQuery.isError) {
    return <SecurityStatusError message={messageFromError(statusQuery.error, '访问设置读取失败')} onRetry={() => void statusQuery.refetch()} />
  }

  if (passwordEnabled && !unlocked) {
    return (
      <SecurityLockScreen
        error={loginError}
        password={password}
        pending={loginMutation.isPending}
        onErrorClose={() => setLoginError(null)}
        onPasswordChange={setPassword}
        onSubmit={submitLogin}
      />
    )
  }

  return (
    <div className="flex h-screen min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3 max-md:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <img className="size-10 shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-slate-200" src={appIconSrc} alt="" />
            <div className="min-w-0">
              <div className="truncate text-lg font-bold">LC Agent</div>
              <div className="text-xs font-medium text-slate-500">v{agentVersion}</div>
            </div>
          </div>
          <nav className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 max-md:hidden">
            {visibleNavItems.map((item) => (
              <Link
                activeProps={{ className: 'bg-white text-blue-700 shadow-sm' }}
                aria-label={item.label}
                className="inline-flex size-9 items-center justify-center rounded-md text-sm font-semibold text-slate-600 lg:h-auto lg:w-auto lg:gap-2 lg:px-3 lg:py-2"
                key={item.to}
                to={item.to}
                title={item.label}
              >
                <item.icon className="size-4" />
                <span className="hidden lg:inline">{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
        <nav className="mx-auto flex max-w-7xl overflow-x-auto px-4 pb-3 md:hidden">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {visibleNavItems.map((item) => (
              <Link
                activeProps={{ className: 'bg-white text-blue-700 shadow-sm' }}
                aria-label={item.label}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-slate-600"
                key={item.to}
                to={item.to}
                title={item.label}
              >
                <item.icon className="size-4" />
              </Link>
            ))}
          </div>
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6 max-md:px-4" ref={mainRef}>
        <div className="mx-auto grid max-w-7xl gap-5">
          <NotificationCenter />
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function SecurityLoading() {
  return (
    <div className="grid h-screen min-h-screen place-items-center bg-slate-50 px-4 text-slate-900">
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <Loader2 className="size-5 animate-spin text-blue-600" />
        <span className="text-sm font-semibold text-slate-700">正在检查访问设置</span>
      </div>
    </div>
  )
}

function SecurityStatusError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid h-screen min-h-screen place-items-center bg-slate-50 px-4 text-slate-900">
      <div className="grid w-full max-w-sm gap-4 rounded-lg border border-red-200 bg-white p-6 shadow-sm shadow-slate-200/60">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-red-50 p-2 text-red-600">
            <AlertCircle className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-slate-900">访问设置读取失败</h1>
            <p className="mt-1 text-sm leading-6 text-slate-600">{message}</p>
          </div>
        </div>
        <Button onClick={onRetry} variant="secondary">
          重试
        </Button>
      </div>
    </div>
  )
}

function SecurityLockScreen({
  error,
  password,
  pending,
  onPasswordChange,
  onErrorClose,
  onSubmit,
}: {
  error: string | null
  password: string
  pending: boolean
  onPasswordChange: (password: string) => void
  onErrorClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div className="grid h-screen min-h-screen place-items-center bg-slate-50 px-4 text-slate-900">
      <form className="grid w-full max-w-sm gap-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/60" onSubmit={onSubmit}>
        <div className="flex items-center gap-3">
          <img className="size-10 rounded-lg object-cover shadow-sm ring-1 ring-slate-200" src={appIconSrc} alt="" />
          <div>
            <h1 className="text-lg font-bold">访问受保护</h1>
          </div>
        </div>
        <Input autoFocus value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="访问密码" type="password" />
        {error ? (
          <InlineAlert variant="error" onClose={onErrorClose}>
            {error}
          </InlineAlert>
        ) : null}
        <Button disabled={pending || !password} type="submit">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
          解锁
        </Button>
      </form>
    </div>
  )
}
