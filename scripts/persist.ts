/**
 * Extract, verify, and persist insights from stored documents.
 *
 *   npm run persist
 *   npm run persist -- --limit 6
 *   npm run persist -- --dry-run          model call, no writes
 *   npm run persist -- --document <uuid>
 *   npm run persist -- --no-rewrite       skip the plain-language pass
 *
 * Reports what verification threw away as prominently as what it kept. A
 * rising rejection rate is the earliest signal that the prompt has drifted,
 * and it is the number the public failure log is built on.
 */

process.loadEnvFile(".env.local")

async function main() {
  const args = process.argv.slice(2)
  const limit = Number(valueOf(args, "--limit") ?? 6)
  const documentId = valueOf(args, "--document")
  const dryRun = args.includes("--dry-run")
  const skipRewrite = args.includes("--no-rewrite")

  const { db } = await import("../db/index")
  const { documents } = await import("../db/schema")
  const { toNormalized } = await import("../lib/storage/documents")
  const { processDocuments } = await import("../lib/pipeline/run")
  const { EXTRACTION_MODEL } = await import("../lib/extract/extract")
  const { eq } = await import("drizzle-orm")

  const rows = documentId
    ? await db.select().from(documents).where(eq(documents.id, documentId))
    : await db.select().from(documents).limit(limit)

  if (rows.length === 0) {
    console.log("no documents stored. run: npm run ingest")
    return
  }

  console.log(`model:     ${EXTRACTION_MODEL}`)
  console.log(`documents: ${rows.length}${dryRun ? "  (dry run, nothing is written)" : ""}\n`)

  const results = await processDocuments(rows.map(toNormalized), { dryRun, skipRewrite })

  let kept = 0
  let rejected = 0
  let inserted = 0
  let rewritten = 0
  let rewriteFailed = 0
  let tokensIn = 0
  let tokensOut = 0

  for (const result of results) {
    console.log(`─ ${truncate(result.title, 72)}`)
    tokensIn += result.usage.inputTokens
    tokensOut += result.usage.outputTokens

    if (result.error) {
      console.log(`  ERROR: ${result.error}\n`)
      continue
    }

    if (result.speakers.length > 0) {
      console.log(
        `  speakers: ${result.speakers.join(", ")}  ` +
          `(${result.priorStanceCount} prior stances in context)`,
      )
    }

    for (const item of result.verified) {
      kept++
      const flagged = item.quoteVerified === "fuzzy" ? ` similarity ${item.similarity.toFixed(3)}` : ""
      console.log(
        `  ✓ [${item.cardType}] [${item.topic}] ${item.candidateName ?? "unattributed"}`,
      )
      console.log(`    ${truncate(item.headline, 88)}`)
      console.log(
        `    ${item.quoteVerified}${flagged} offsets=${item.quoteCharStart}..${item.quoteCharEnd}` +
          `  topics=${item.topics.join("+")}`,
      )
    }

    for (const r of result.rejected) {
      rejected++
      console.log(`  ✗ REJECTED [${r.item.cardType}] ${r.reason}`)
      console.log(`    claimed quote: "${truncate(r.item.quote, 90)}"`)
    }

    for (const d of result.deduped) {
      console.log(`  · collapsed: ${d.reason}`)
    }

    inserted += result.inserted
    rewritten += result.rewritten
    rewriteFailed += result.rewriteFailures.length

    // The rewrite is allowed to fail, which is exactly why its failures are
    // printed: silent degradation is how "plain language is optional" turns
    // into "plain language never works and nobody noticed".
    for (const failure of result.rewriteFailures) {
      console.log(`  ~ no rewrite: ${failure.reason}`)
      console.log(`    ${truncate(failure.headline, 88)}`)
    }

    if (result.unknownTopics.length > 0) {
      console.log(`  ! topics not in the taxonomy, dropped: ${result.unknownTopics.join(", ")}`)
    }

    if (!dryRun) {
      console.log(
        `  stored ${result.inserted}` +
          (result.duplicates > 0 ? `, ${result.duplicates} already present` : "") +
          (result.stanceLinks > 0 ? `, ${result.stanceLinks} stance links` : "") +
          (result.topicLinks > 0 ? `, ${result.topicLinks} topic tags` : ""),
      )
    }

    if (result.verified.length === 0 && result.rejected.length === 0) {
      console.log("  (nothing quotable)")
    }
    console.log()
  }

  const total = kept + rejected
  console.log("─".repeat(60))
  console.log(
    `verified ${kept}, rejected ${rejected}` +
      (total > 0 ? ` (${Math.round((rejected / total) * 100)}% rejection rate)` : ""),
  )
  if (!skipRewrite) {
    const attempted = rewritten + rewriteFailed
    console.log(
      `plain-language rewrites: ${rewritten} of ${attempted}` +
        (rewriteFailed > 0
          ? `  (${rewriteFailed} served with the quote alone, which is the fallback working)`
          : ""),
    )
  }
  if (!dryRun) console.log(`inserted ${inserted} insights`)
  console.log(`tokens: ${tokensIn.toLocaleString()} in, ${tokensOut.toLocaleString()} out`)
}

function valueOf(args: string[], flag: string): string | undefined {
  const exact = args.indexOf(flag)
  if (exact >= 0 && args[exact + 1] && !args[exact + 1].startsWith("--")) {
    return args[exact + 1]
  }
  const inline = args.find((a) => a.startsWith(`${flag}=`))
  return inline?.slice(flag.length + 1)
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
