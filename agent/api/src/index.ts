import { config } from './config'
import { createAgentApp } from './app'
import { initDb } from './db'
import { startAgentBrokerRuntime } from './http/routes'
import { runAccountHealthMaintenance } from './baidu/health'
import { getAccountHealthSettings } from './settings/service'

initDb()
startAgentBrokerRuntime()

setInterval(() => {
  void runAccountHealthMaintenance()
}, getAccountHealthSettings().accountHealthIntervalSeconds * 1000)

const app = createAgentApp()
const server = Bun.serve({
  hostname: '0.0.0.0',
  port: config.port,
  fetch: app.fetch,
})

console.log(`LC Agent API listening on http://localhost:${server.port}`)

export type { AppType, ClientAppType, ApiErrorResponse } from './http/routes'
