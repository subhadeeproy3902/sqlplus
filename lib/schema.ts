import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const User = pgTable('user', {
  user_id: text('user_id').primaryKey().notNull(),
  createTs: timestamp('create_ts').defaultNow().notNull(),
})