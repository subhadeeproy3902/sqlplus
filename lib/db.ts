import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env" }); // or .env.local

const url = process.env.DATABASE_URL!;

const sql = neon(url as string);
export const db = drizzle({ client: sql });
