import { config } from 'dotenv';
import { defineConfig } from "drizzle-kit";
config({ path: '.env' });

export default defineConfig({
  dialect: 'postgresql',
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  schema: './lib/schema.ts',
})