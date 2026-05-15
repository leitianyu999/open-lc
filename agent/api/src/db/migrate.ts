import { sqlite, runSchemaMigrations } from './index'

runSchemaMigrations()
sqlite.close()
