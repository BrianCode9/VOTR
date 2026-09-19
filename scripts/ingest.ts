/**
 * Pull documents from the registered source adapters into Postgres.
 *
 *   npm run ingest
 *   npm run ingest -- --adapter rss --since 3d
 *   npm run ingest -- --adapter gdelt,html
 *   npm run ingest -- --list
 *
 * Ingestion only. No extraction, no verification, no model call. This exists
 * to prove the adapter path stores full raw text, which every later stage
 * depends on, and it runs without an ANTHROPIC_API_KEY.
 */

process.loadEnvFile(".env.local")

async function main() {
  const args = process.argv.slice(2)
  const { registry } = await import("../lib/adapters")

  if (args.includes("--list")) {
    console.log("registered adapters:\n")
    for (const adapter of registry.all()) {
      console.log(`  ${adapter.id.padEnd(10)} ${adapter.label}  [${adapter.sourceType}]`)
    }
    return
  }

  const adapterIds = valueOf(args, "--adapter")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const since = parseSince(valueOf(args, "--since"))

  const unknown = (adapterIds ?? []).filter((id) => !registry.has(id))
  if (unknown.length > 0) {
    console.error(`unknown adapter(s): ${unknown.join(", ")}`)
    console.error(`registered: ${registry.ids().join(", ")}`)
    process.exit(1)
  }

  console.log(`adapters: ${(adapterIds ?? registry.ids()).join(", ")}`)
  console.log(`since:    ${since ? since.toISOString() : "(no cutoff)"}\n`)

  const { ingest } = await import("../lib/pipeline/run")

  const started = Date.now()
  const run = await ingest(since, adapterIds)
  const elapsed = Date.now() - started

  console.log(`fetched ${run.fetched} documents in ${elapsed}ms`)
  for (const [id, count] of Object.entries(run.byAdapter)) {
    console.log(`  ${id.padEnd(10)} ${count}`)
  }

  if (run.failures.length > 0) {
    console.log(`\n${run.failures.length} failed (expected, the run continues):`)
    for (const f of run.failures.slice(0, 20)) {
      console.log(`  - ${truncate(f.url, 70)}\n      ${f.reason}`)
    }
  }

  console.log(`\nstored ${run.stored.length} new, skipped ${run.skipped} already present`)
  for (const row of run.stored) {
    console.log(`  + ${truncate(row.title, 80)}`)
  }
}

function valueOf(args: string[], flag: string): string | undefined {
  const exact = args.indexOf(flag)
  if (exact >= 0 && args[exact + 1] && !args[exact + 1].startsWith("--")) {
    return args[exact + 1]
  }
  const inline = args.find((a) => a.startsWith(`${flag}=`))
  return inline?.slice(flag.length + 1)
}

/** Accepts "3d", "12h", "90m", or an ISO date. */
function parseSince(value: string | undefined): Date | null {
  if (!value) return null

  const relative = /^(\d+)([dhm])$/.exec(value.trim())
  if (relative) {
    const n = Number(relative[1])
    const ms = relative[2] === "d" ? 86_400_000 : relative[2] === "h" ? 3_600_000 : 60_000
    return new Date(Date.now() - n * ms)
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    console.error(`--since could not be parsed: ${value}`)
    process.exit(1)
  }
  return parsed
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…"
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })

// Marks this file as a module: every script here declares a `main`, and
// without it they share one global scope.
export {}
