import { sql } from 'drizzle-orm'
import { getTempFileCleanupSummary, hasActiveParseJobs, type TempFileCleanupSummary } from '../baidu/service'
import { beginBrokerMaintenanceStop, endBrokerMaintenanceStop, getActiveBrokerExecutionCount, interruptActiveBrokerRuns } from '../broker/runtime'
import { db, sqlite } from '../db'
import {
  accountHealthChecks,
  accountStatusEvents,
  accountTokenEvents,
  appSettings,
  baiduAccounts,
  baiduTempFiles,
  brokerRunEvents,
  brokerRuns,
  parseAttempts,
  parseEvents,
  parseJobs,
  parseRecords,
  users,
} from '../db/schema'
import { ensureSystemUser, SYSTEM_USER_ID } from '../localUser'
import { conflict } from '../lib/errors'

type MaintenanceSummary = {
  parseJobs: number
  parseRecords: number
  parseEvents: number
  baiduTempFiles: number
  accountEvents: number
  brokerRuns: number
  brokerRunEvents: number
  baiduAccounts: number
  appSettings: number
  activeParseJobs: number
  activeBrokerRuns: number
  tempFileCleanup: TempFileCleanupSummary
}

const countSql = (tableName: string, where = '') => {
  const suffix = where ? ` WHERE ${where}` : ''
  const row = sqlite.query<{ value: number }, []>(`SELECT COUNT(*) AS value FROM ${tableName}${suffix}`).get()
  return Number(row?.value ?? 0)
}

const deleteFrom = (table: Parameters<typeof db.delete>[0]) => {
  db.delete(table).run()
}

export const getMaintenanceSummary = (): MaintenanceSummary => ({
  parseJobs: countSql('parse_jobs'),
  parseRecords: countSql('parse_records'),
  parseEvents: countSql('parse_events'),
  baiduTempFiles: countSql('baidu_temp_files'),
  accountEvents: countSql('account_health_checks') + countSql('account_status_events') + countSql('account_token_events'),
  brokerRuns: countSql('broker_runs'),
  brokerRunEvents: countSql('broker_run_events'),
  baiduAccounts: countSql('baidu_accounts'),
  appSettings: countSql('app_settings'),
  activeParseJobs: countSql('parse_jobs', "status IN ('queued', 'running')"),
  activeBrokerRuns: countSql('broker_runs', "status IN ('idle', 'polling', 'participating', 'waiting', 'active', 'parsing', 'submitting')"),
  tempFileCleanup: getTempFileCleanupSummary(),
})

const assertNoActiveParseJobs = () => {
  if (hasActiveParseJobs()) {
    throw conflict('MAINTENANCE_PARSE_RUNNING', '当前有解析任务正在执行，请稍后再试')
  }
}

const interruptBrokerBeforeMaintenance = () => {
  if (getActiveBrokerExecutionCount() > 0) {
    throw conflict('MAINTENANCE_BROKER_RUNNING', '当前有 Broker 运行正在执行，请稍后再试')
  }
  beginBrokerMaintenanceStop()
  try {
    return interruptActiveBrokerRuns()
  } catch (error) {
    endBrokerMaintenanceStop({ restart: true })
    throw error
  }
}

const cleanupRuntimeTables = () => {
  deleteFrom(brokerRunEvents)
  deleteFrom(brokerRuns)
  deleteFrom(parseEvents)
  deleteFrom(parseAttempts)
  deleteFrom(baiduTempFiles)
  deleteFrom(parseJobs)
  deleteFrom(parseRecords)
  deleteFrom(accountHealthChecks)
  deleteFrom(accountStatusEvents)
  deleteFrom(accountTokenEvents)
}

export const cleanupRuntimeData = () => {
  assertNoActiveParseJobs()
  const before = getMaintenanceSummary()
  const interruptedBrokerRuns = interruptBrokerBeforeMaintenance()
  try {
    sqlite.transaction(() => {
      cleanupRuntimeTables()
    })()
    return {
      before,
      after: getMaintenanceSummary(),
      interruptedBrokerRuns,
    }
  } finally {
    endBrokerMaintenanceStop({ restart: true })
  }
}

export const factoryResetAgentData = () => {
  assertNoActiveParseJobs()
  const before = getMaintenanceSummary()
  const interruptedBrokerRuns = interruptBrokerBeforeMaintenance()
  try {
    sqlite.transaction(() => {
      cleanupRuntimeTables()
      deleteFrom(baiduAccounts)
      deleteFrom(appSettings)
      db.delete(users).where(sql`${users.id} != ${SYSTEM_USER_ID}`).run()
    })()
    ensureSystemUser()
    return {
      before,
      after: getMaintenanceSummary(),
      interruptedBrokerRuns,
    }
  } finally {
    endBrokerMaintenanceStop()
  }
}
