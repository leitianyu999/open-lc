import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { config } from '../config'
import { runDrizzleMigrationsDestructively } from './destructiveMigrations'
import * as schema from './schema'

const migrationsFolder = config.migrationsDir || fileURLToPath(new URL('../../../drizzle', import.meta.url))

mkdirSync(dirname(config.databaseUrl), { recursive: true })

export const sqlite = new Database(config.databaseUrl)
sqlite.exec('PRAGMA journal_mode = WAL')
sqlite.exec('PRAGMA foreign_keys = ON')

export const db = drizzle(sqlite, { schema })

export const lastInsertId = () => {
  const row = sqlite.query<{ id: number }, []>('SELECT last_insert_rowid() AS id').get()
  return Number(row?.id ?? 0)
}

export const runSchemaMigrations = () => {
  runDrizzleMigrationsDestructively(sqlite, db, migrationsFolder)
}

const markInterruptedJobs = () => {
  db.update(schema.parseJobs)
    .set({
      status: 'failed',
      errorCode: 'JOB_INTERRUPTED',
      errorMessage: '服务重启，任务已中断',
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(sql`${schema.parseJobs.status} IN ('queued', 'running')`)
    .run()
}

export const initDb = () => {
  runSchemaMigrations()
  markInterruptedJobs()
}
