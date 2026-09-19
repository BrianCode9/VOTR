import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

/**
 * App runtime uses the POOLED connection. Neon scales compute to zero, so a
 * long-lived direct connection per serverless invocation exhausts the compute
 * quickly. Migrations and scripts use DATABASE_URL_UNPOOLED instead, see
 * drizzle.config.ts.
 */
const url = process.env.DATABASE_URL

if (!url) {
  throw new Error("DATABASE_URL is not set. Run `neon env pull` to populate .env.local.")
}

// Next dev reloads modules on every edit. Without this the process accumulates
// one connection pool per reload until Neon starts refusing connections.
const globalForDb = globalThis as unknown as { conn?: ReturnType<typeof postgres> }

const conn = globalForDb.conn ?? postgres(url, { max: 5 })
if (process.env.NODE_ENV !== "production") globalForDb.conn = conn

export const db = drizzle(conn, { schema })
export { schema }
