import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

/**
 * App runtime uses the POOLED connection. Neon scales compute to zero, so a
 * long-lived direct connection per serverless invocation exhausts the compute
 * quickly. Migrations and scripts use DATABASE_URL_UNPOOLED, see
 * drizzle.config.ts.
 */

/**
 * True when a connection string is configured.
 *
 * Callers that can degrade gracefully should check this rather than letting
 * the connection throw. Someone working on the UI who is not in the Neon org
 * yet still needs `npm run dev` to start.
 */
export const hasDatabase = Boolean(process.env.DATABASE_URL)

// Next dev reloads modules on every edit. Without this the process accumulates
// one connection pool per reload until Neon starts refusing connections.
const globalForDb = globalThis as unknown as {
  conn?: ReturnType<typeof postgres>
  drizzleDb?: ReturnType<typeof drizzle<typeof schema>>
}

function connect() {
  if (globalForDb.drizzleDb) return globalForDb.drizzleDb

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Run `npm run setup`. If that reports that the " +
        "env pull failed, you are not in the Neon org yet and need an invite.",
    )
  }

  const conn = globalForDb.conn ?? postgres(url, { max: 5 })
  const instance = drizzle(conn, { schema })

  if (process.env.NODE_ENV !== "production") {
    globalForDb.conn = conn
    globalForDb.drizzleDb = instance
  }
  return instance
}

/**
 * Connects on first use rather than at import.
 *
 * Importing this module used to throw when DATABASE_URL was absent, which took
 * down `npm run dev` entirely for anyone without database access. Now the
 * error surfaces only where a query is actually attempted, and callers that
 * check `hasDatabase` never trigger it at all.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    return Reflect.get(connect(), prop, receiver)
  },
})

export { schema }
