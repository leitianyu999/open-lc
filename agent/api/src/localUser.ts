import { eq } from 'drizzle-orm'
import { db } from './db'
import { users } from './db/schema'

export const SYSTEM_USER_ID = 1

export const ensureSystemUser = () => {
  const existing = db.select().from(users).where(eq(users.id, SYSTEM_USER_ID)).get()
  if (existing) return existing
  db.insert(users).values({
    id: SYSTEM_USER_ID,
    username: 'local-agent',
    displayName: 'Local Agent',
    isAdmin: true,
  }).run()
  return db.select().from(users).where(eq(users.id, SYSTEM_USER_ID)).get()!
}
