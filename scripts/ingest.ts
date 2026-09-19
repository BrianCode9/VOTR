/**
 * End-to-end ingest of one RSS feed into Postgres.
 *
 *   npm run ingest
 *   npm run ingest -- https://feeds.npr.org/1014/rss.xml --limit 10
 *
 * Step 1 of the pipeline only. No triage, no extraction, no verification. This
 * exists to prove the adapter path stores full raw text, which every later
 * stage depends on.
 */

import { fetchRssFeed } from "../lib/adapters/rss"
import type { Document } from "../lib/adapters/types"

process.loadEnvFile(".env.local")

const DEFAULT_FEED = "https://feeds.npr.org/1014/rss.xml"

async function main() {
  const args = process.argv.slice(2)

  // Walk the args so a flag's value is never mistaken for the feed URL.
  let feedUrl: string | undefined
  let limit = 10
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--limit") {
      limit = Number(args[++i])
    } else if (arg.startsWith("--limit=")) {
      limit = Number(arg.slice("--limit=".length))
    } else if (!arg.startsWith("--") && !feedUrl) {
      feedUrl = arg
    }
  }
  feedUrl ??= DEFAULT_FEED

  if (!Number.isFinite(limit) || limit < 1) {
    console.error("--limit must be a positive number")
    process.exit(1)
  }

  console.log(`feed:  ${feedUrl}`)
  console.log(`limit: ${limit}\n`)

  const started = Date.now()
  const run = await fetchRssFeed(feedUrl, { limit })
  const fetchMs = Date.now() - started

  console.log(`fetched ${run.documents.length} documents in ${fetchMs}ms`)
  if (run.failures.length > 0) {
    console.log(`\n${run.failures.length} failed (expected, the run continues):`)
    for (const f of run.failures) {
      console.log(`  - ${truncate(f.url, 70)}\n      ${f.reason}`)
    }
  }

  if (run.documents.length === 0) {
    console.log("\nnothing to store")
    return
  }

  // Imported lazily so a feed-only dry run does not open a connection.
  const { db } = await import("../db/index")
  const { documents: documentsTable } = await import("../db/schema")

  const rows = run.documents.map(toRow)

  const inserted = await db
    .insert(documentsTable)
    .values(rows)
    // Documents are immutable once stored. A URL we already have is skipped
    // rather than updated, because updating raw_text would silently invalidate
    // every quote offset already pointing into it.
    .onConflictDoNothing({ target: documentsTable.url })
    .returning({ id: documentsTable.id, title: documentsTable.title })

  console.log(`\nstored ${inserted.length} new, skipped ${rows.length - inserted.length} already present`)
  for (const row of inserted) {
    console.log(`  + ${truncate(row.title, 80)}`)
  }

  const chars = run.documents.reduce((n, d) => n + d.rawText.length, 0)
  console.log(
    `\nraw text: ${chars.toLocaleString()} chars across ${run.documents.length} documents` +
      ` (avg ${Math.round(chars / run.documents.length).toLocaleString()})`,
  )

  process.exit(0)
}

function toRow(d: Document) {
  return {
    url: d.url,
    sourceType: d.sourceType,
    sourceName: d.sourceName,
    title: d.title,
    publishedAt: d.publishedAt,
    rawText: d.rawText,
    mediaType: d.mediaType,
    durationSeconds: d.durationSeconds ?? null,
    isSynthetic: d.isSynthetic,
    submittedByUser: d.submittedByUser ?? null,
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…"
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
