import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './agent/api/src/db/schema.ts',
  out: './agent/drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.LC_AGENT_DATABASE_URL ?? 'data/agent.sqlite',
  },
})
