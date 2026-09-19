import { defineConfig } from "drizzle-kit"

// drizzle-kit reads .env but not .env.local, which is where `neon env pull`
// writes. Node 20.12+ can load it directly, no dotenv dependency needed.
try {
  process.loadEnvFile(".env.local")
} catch {
  // Absent in CI or a fresh clone; the explicit error below is the better message.
}

/**
 * Migrations run on the UNPOOLED connection.
 *
 * Neon's pooled endpoint sits behind PgBouncer in transaction mode, which does
 * not support the session-level statements DDL and advisory locks rely on.
 * Running migrations through it fails in ways that look like network problems.
 */
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL

if (!url) {
  throw new Error(
    "DATABASE_URL_UNPOOLED is not set. Run `neon env pull` to populate .env.local.",
  )
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
