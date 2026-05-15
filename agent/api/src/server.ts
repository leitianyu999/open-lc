import { config } from './config'
import { initDb, sqlite } from './db'
import { runAccountHealthMaintenance } from './baidu/health'
import { createAgentApp, type CreateAgentAppOptions } from './app'
import { startAgentBrokerRuntime, stopAgentBrokerRuntime } from './http/routes'
import { getAccountHealthSettings } from './settings/service'

export type AgentServerOptions = CreateAgentAppOptions & {
  hostname?: string
  port?: number
  startBrokerRuntime?: boolean
  startHealthMaintenance?: boolean
}

export type AgentServerHandle = {
  server: Bun.Server<undefined>
  hostname: string
  port: number
  url: string
  localUrl: string
  stopHttp: () => Promise<void>
  stop: () => Promise<void>
}

let initialized = false
let accountHealthTimer: ReturnType<typeof setInterval> | null = null

export const initAgentRuntime = () => {
  if (initialized) return
  initialized = true
  initDb()
}

const startAccountHealthMaintenance = () => {
  if (accountHealthTimer) clearInterval(accountHealthTimer)
  accountHealthTimer = setInterval(() => {
    void runAccountHealthMaintenance()
  }, getAccountHealthSettings().accountHealthIntervalSeconds * 1000)
}

export const stopAgentRuntime = () => {
  if (accountHealthTimer) {
    clearInterval(accountHealthTimer)
    accountHealthTimer = null
  }
  stopAgentBrokerRuntime()
}

export const startAgentServer = (options: AgentServerOptions = {}): AgentServerHandle => {
  initAgentRuntime()

  if (options.startBrokerRuntime !== false) {
    startAgentBrokerRuntime()
  }
  if (options.startHealthMaintenance !== false) {
    startAccountHealthMaintenance()
  }

  const hostname = options.hostname ?? '0.0.0.0'
  const port = options.port ?? config.port
  const app = createAgentApp({ webDistRoot: options.webDistRoot })
  const server = Bun.serve({
    hostname,
    port,
    fetch: app.fetch,
  })

  const displayHost = hostname === '0.0.0.0' ? '127.0.0.1' : hostname
  const actualPort = server.port ?? port
  const localUrl = `http://127.0.0.1:${actualPort}`
  const stopHttp = () => server.stop(true)

  return {
    server,
    hostname,
    port: actualPort,
    url: `http://${displayHost}:${actualPort}`,
    localUrl,
    stopHttp,
    stop: async () => {
      await stopHttp()
      stopAgentRuntime()
      sqlite.close()
    },
  }
}
