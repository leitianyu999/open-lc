import { existsSync, mkdirSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Electrobun, { BrowserWindow, Utils } from 'electrobun/bun'
import type { AgentServerHandle } from '@lc-agent/api/server'
import type { DesktopRuntimeSnapshot, DesktopSwitchResult } from '@lc-agent/api/desktop/runtime'

const localHost = '127.0.0.1'
const externalHost = '0.0.0.0'

type ApplicationMenuRole =
  | 'about'
  | 'quit'
  | 'hide'
  | 'hideOthers'
  | 'showAll'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'

type ApplicationMenuItem =
  | {
    label?: string
    role?: ApplicationMenuRole
    submenu?: ApplicationMenuItem[]
  }
  | {
    type: 'divider' | 'separator'
  }

const fileExists = (path: string) => existsSync(path)

const appDataRoot = () => {
  const explicit = Bun.env.LC_AGENT_DESKTOP_DATA_DIR?.trim()
  if (explicit) return explicit

  const home = Bun.env.HOME?.trim()
  if (process.platform === 'darwin' && home) {
    return join(home, 'Library', 'Application Support', 'LC Agent')
  }
  if (process.platform === 'win32') {
    const base = Bun.env.APPDATA?.trim() || (home ? join(home, 'AppData', 'Roaming') : '')
    if (base) return join(base, 'LC Agent')
  }
  const base = Bun.env.XDG_DATA_HOME?.trim() || (home ? join(home, '.local', 'share') : '/tmp')
  return join(base, 'lc-agent')
}

const configuredPort = () => {
  const requested = Number(Bun.env.LC_AGENT_DESKTOP_PORT || Bun.env.LC_AGENT_PORT || 0)
  return Number.isFinite(requested) && requested > 0 ? requested : 0
}

const waitForHealth = async (url: string) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) return
    } catch {
      await Bun.sleep(100)
    }
  }
  throw new Error(`Agent server did not become healthy at ${url}`)
}

const hostForExternalAccess = (enabled: boolean) => enabled ? externalHost : localHost

const externalUrlsForPort = (port: number) => {
  const urls: string[] = []
  const interfaces = networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4') continue
      urls.push(`http://${entry.address}:${port}`)
    }
  }
  return Array.from(new Set(urls))
}

const editMenu = (): ApplicationMenuItem => ({
  label: '编辑',
  submenu: [
    { label: '撤销', role: 'undo' },
    { label: '重做', role: 'redo' },
    { type: 'separator' },
    { label: '剪切', role: 'cut' },
    { label: '复制', role: 'copy' },
    { label: '粘贴', role: 'paste' },
    { type: 'separator' },
    { label: '全选', role: 'selectAll' },
  ],
})

const installApplicationMenu = () => {
  const appMenu: ApplicationMenuItem[] = process.platform === 'darwin'
    ? [
      {
        label: 'LC Agent',
        submenu: [
          { label: '关于 LC Agent', role: 'about' },
          { type: 'separator' },
          { label: '隐藏 LC Agent', role: 'hide' },
          { label: '隐藏其他', role: 'hideOthers' },
          { label: '显示全部', role: 'showAll' },
          { type: 'separator' },
          { label: '退出 LC Agent', role: 'quit' },
        ],
      },
      editMenu(),
    ]
    : [
      editMenu(),
    ]

  Electrobun.ApplicationMenu.setApplicationMenu(appMenu)
}

const root = appDataRoot()
const dataDir = join(root, 'data')
const tempDir = join(root, 'tmp')
const databaseUrl = join(dataDir, 'agent.sqlite')
const devWebDist = fileURLToPath(new URL('../../web/dist/', import.meta.url))
const devMigrationsDir = fileURLToPath(new URL('../../drizzle/', import.meta.url))
const bundledWebDist = join(import.meta.dir, '..', 'web', 'dist')
const bundledMigrationsDir = join(import.meta.dir, '..', 'drizzle')
const webDistRoot = fileExists(join(bundledWebDist, 'index.html')) ? bundledWebDist : devWebDist
const migrationsDir = fileExists(join(bundledMigrationsDir, 'meta', '_journal.json')) ? bundledMigrationsDir : devMigrationsDir
const port = configuredPort()

mkdirSync(dataDir, { recursive: true })
mkdirSync(tempDir, { recursive: true })

console.log(`[LC Agent Desktop] data dir: ${dataDir}`)
console.log(`[LC Agent Desktop] web dist: ${webDistRoot}`)
console.log(`[LC Agent Desktop] migrations: ${migrationsDir}`)

Bun.env.LC_AGENT_PORT = String(port)
Bun.env.LC_AGENT_DATABASE_URL = databaseUrl
Bun.env.LC_AGENT_BAIDU_TEMP_DIR = tempDir
Bun.env.LC_AGENT_WEB_DIST_DIR = webDistRoot
Bun.env.LC_AGENT_MIGRATIONS_DIR = migrationsDir
Bun.env.LC_AGENT_NODE_ENV = Bun.env.LC_AGENT_NODE_ENV || 'production'
Bun.env.LC_AGENT_DESKTOP = '1'

const { initAgentRuntime, startAgentServer } = await import('@lc-agent/api/server')
const {
  getDesktopExternalAccessEnabled,
  registerDesktopController,
  saveDesktopExternalAccessEnabled,
} = await import('@lc-agent/api/desktop/runtime')

initAgentRuntime()

let externalAccessEnabled = getDesktopExternalAccessEnabled()
let desiredExternalAccessEnabled = externalAccessEnabled
let agent: AgentServerHandle = startAgentServer({
  hostname: hostForExternalAccess(externalAccessEnabled),
  port,
  webDistRoot,
})
let restartPending = false
let lastSwitchError: string | null = null
let restartTimer: ReturnType<typeof setTimeout> | null = null
let restartChain: Promise<void> = Promise.resolve()
let mainWindow: BrowserWindow | null = null

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const runtimeSnapshot = (): DesktopRuntimeSnapshot => {
  const externalUrls = externalUrlsForPort(agent.port)
  return {
    desktopMode: true,
    externalAccessEnabled,
    restartPending,
    lastSwitchError,
    bindHost: agent.hostname,
    port: agent.port,
    localUrl: agent.localUrl,
    externalUrls,
    primaryExternalUrl: externalUrls[0] ?? null,
  }
}

const switchListener = async (): Promise<DesktopSwitchResult> => {
  const enabled = desiredExternalAccessEnabled
  const nextHost = hostForExternalAccess(enabled)
  if (agent.hostname === nextHost) {
    externalAccessEnabled = enabled
    lastSwitchError = null
    return { ok: true }
  }

  const previousAgent = agent
  const previousEnabled = externalAccessEnabled
  const previousHost = previousAgent.hostname

  try {
    await previousAgent.stopHttp()
    const nextAgent = startAgentServer({
      hostname: nextHost,
      port: previousAgent.port,
      webDistRoot,
      startBrokerRuntime: false,
      startHealthMaintenance: false,
    })
    agent = nextAgent
    externalAccessEnabled = enabled
    Bun.env.LC_AGENT_APP_ORIGIN = nextAgent.localUrl
    await waitForHealth(nextAgent.localUrl)
    lastSwitchError = null
    console.log(`[LC Agent Desktop] listener: ${nextAgent.hostname}:${nextAgent.port}`)
    return { ok: true }
  } catch (error) {
    saveDesktopExternalAccessEnabled(previousEnabled)
    desiredExternalAccessEnabled = previousEnabled
    externalAccessEnabled = previousEnabled
    lastSwitchError = errorMessage(error)

    try {
      agent = startAgentServer({
        hostname: previousHost,
        port: previousAgent.port,
        webDistRoot,
        startBrokerRuntime: false,
        startHealthMaintenance: false,
      })
      Bun.env.LC_AGENT_APP_ORIGIN = agent.localUrl
    } catch (rollbackError) {
      console.error('[LC Agent Desktop] failed to restore previous listener', rollbackError)
    }

    console.error('[LC Agent Desktop] failed to switch listener', error)
    return { ok: false, error: lastSwitchError }
  }
}

const scheduleListenerSwitch = () => {
  restartPending = true
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    restartChain = restartChain
      .then(async () => {
        await switchListener()
      })
      .finally(() => {
        restartPending = false
      })
  }, 250)
}

registerDesktopController({
  getRuntime: runtimeSnapshot,
  setExternalAccess: (enabled: boolean) => {
    desiredExternalAccessEnabled = enabled
    externalAccessEnabled = enabled
    scheduleListenerSwitch()
    return { ok: true }
  },
  openExternalBrowser: () => {
    const snapshot = runtimeSnapshot()
    const url = snapshot.externalAccessEnabled
      ? snapshot.primaryExternalUrl || snapshot.localUrl
      : snapshot.localUrl
    if (!url) throw new Error('没有可用访问地址')
    const opened = Utils.openExternal(url)
    if (!opened) throw new Error('打开外部浏览器失败')
    return snapshot
  },
})

const origin = agent.localUrl
Bun.env.LC_AGENT_APP_ORIGIN = origin
console.log(`[LC Agent Desktop] server: ${origin}`)
console.log(`[LC Agent Desktop] listener: ${agent.hostname}:${agent.port}`)

await waitForHealth(origin)
console.log('[LC Agent Desktop] server is healthy, opening window')

installApplicationMenu()

mainWindow = new BrowserWindow({
  title: 'LC Agent',
  url: origin,
  frame: {
    width: 1280,
    height: 860,
    x: 120,
    y: 80,
  },
})

let stopped = false
const shutdown = async () => {
  if (stopped) return
  stopped = true
  if (restartTimer) clearTimeout(restartTimer)
  await restartChain.catch(() => undefined)
  await agent.stop()
}

Electrobun.events.on('close', (event: { data: { id: number } }) => {
  if (event.data.id === mainWindow?.id) void shutdown()
})
