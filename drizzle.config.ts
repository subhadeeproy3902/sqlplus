import { defineConfig } from 'drizzle-kit'
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be a Neon postgres connection string')
}

export default defineConfig({
  dialect: 'postgresql',
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  schema: './lib/schema.ts',
})