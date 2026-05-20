import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from 'bun:sqlite'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { migrate as migrateDrizzle } from 'drizzle-orm/bun-sqlite/migrator'

type JournalEntry = {
  tag: string
  when: number
}

type MigrationFile = JournalEntry & {
  hash: string
}

type SqliteObject = {
  name: string
  type: 'index' | 'table' | 'trigger' | 'view'
}

type AppliedMigrationRow = {
  hash: string
  created_at: number | string | null
}

const migrationTable = '__drizzle_migrations'

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`

const readMigrationFiles = (migrationsFolder: string): MigrationFile[] => {
  const journalPath = join(migrationsFolder, 'meta', '_journal.json')
  if (!existsSync(journalPath)) {
    throw new Error(`Missing Drizzle migration journal: ${journalPath}`)
  }

  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries?: JournalEntry[] }
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error(`Drizzle migration journal has no entries: ${journalPath}`)
  }

  return journal.entries.map((entry) => {
    if (!entry.tag || !Number.isFinite(entry.when)) {
      throw new Error(`Invalid Drizzle migration journal entry in ${journalPath}`)
    }

    const migrationPath = join(migrationsFolder, `${entry.tag}.sql`)
    if (!existsSync(migrationPath)) {
      throw new Error(`Missing Drizzle migration file: ${migrationPath}`)
    }

    const migrationSql = readFileSync(migrationPath, 'utf8')
    return {
      tag: entry.tag,
      when: entry.when,
      hash: createHash('sha256').update(migrationSql).digest('hex'),
    }
  })
}

const listUserObjects = (sqlite: Database) =>
  sqlite
    .query<SqliteObject, []>(`
    SELECT type, name
    FROM sqlite_master
    WHERE type IN ('table', 'index', 'view', 'trigger')
      AND name NOT LIKE 'sqlite_%'
    ORDER BY
      CASE type
        WHEN 'trigger' THEN 1
        WHEN 'view' THEN 2
        WHEN 'index' THEN 3
        WHEN 'table' THEN 4
        ELSE 5
      END
  `)
    .all()

const tableExists = (sqlite: Database, table: string) =>
  Boolean(sqlite.query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))

const readAppliedMigrations = (sqlite: Database) =>
  sqlite.query<AppliedMigrationRow, []>(`SELECT hash, created_at FROM ${quoteIdentifier(migrationTable)} ORDER BY created_at ASC`).all()

const migrationHistoryMatches = (sqlite: Database, migrations: MigrationFile[]) => {
  const objects = listUserObjects(sqlite)
  const hasApplicationObjects = objects.some((object) => object.name !== migrationTable)

  if (!tableExists(sqlite, migrationTable)) {
    return !hasApplicationObjects
  }

  let applied: AppliedMigrationRow[]
  try {
    applied = readAppliedMigrations(sqlite)
  } catch {
    return false
  }

  if (applied.length === 0) {
    return !hasApplicationObjects
  }
  if (applied.length > migrations.length) {
    return false
  }

  return applied.every((row, index) => {
    const migration = migrations[index]
    return Boolean(migration) && row.hash === migration.hash && Number(row.created_at) === migration.when
  })
}

const dropUserObjects = (sqlite: Database) => {
  const objects = listUserObjects(sqlite)
  sqlite.exec('PRAGMA foreign_keys = OFF')
  try {
    for (const type of ['trigger', 'view', 'index', 'table'] as const) {
      for (const object of objects.filter((item) => item.type === type)) {
        sqlite.exec(`DROP ${type.toUpperCase()} IF EXISTS ${quoteIdentifier(object.name)}`)
      }
    }
  } finally {
    sqlite.exec('PRAGMA foreign_keys = ON')
  }
}

export const runDrizzleMigrationsDestructively = <TSchema extends Record<string, unknown>>(
  sqlite: Database,
  db: BunSQLiteDatabase<TSchema>,
  migrationsFolder: string,
) => {
  const migrations = readMigrationFiles(migrationsFolder)
  if (!migrationHistoryMatches(sqlite, migrations)) {
    dropUserObjects(sqlite)
  }
  migrateDrizzle(db, { migrationsFolder })
}
