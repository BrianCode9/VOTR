/**
 * Run extraction plus verification over stored documents.
 *
 *   npm run extract
 *   npm run extract -- --limit 3
 *
 * Reports what the model returned and, critically, what verification threw
 * away. A high rejection rate here is the signal that the prompt is drifting,
 * and it is exactly the number the public failure log is built on.
 */

import { extractInsights, EXTRACTION_MODEL } from "../lib/extract/extract"
import type { Document } from "../lib/adapters/types"

process.loadEnvFile(".env.local")

async function main() {
  const args = process.argv.slice(2)
  const limitIdx = args.indexOf("--limit")
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 2

  const { db } = await import("../db/index")
  const { documents } = await import("../db/schema")

  const rows = await db.select().from(documents).limit(limit)
  console.log(`model: ${EXTRACTION_MODEL}`)
  console.log(`documents: ${rows.length}\n`)

  let totalVerified = 0
  let totalRejected = 0
  let totalIn = 0
  let totalOut = 0

  for (const row of rows) {
    const doc: Document = {
      url: row.url,
      sourceType: "rss",
      sourceName: row.sourceName,
      title: row.title,
      publishedAt: row.publishedAt,
      rawText: row.rawText,
      mediaType: row.mediaType,
      isSynthetic: row.isSynthetic,
    }

    console.log(`─ ${row.title.slice(0, 72)}`)

    const run = await extractInsights(doc)
    totalIn += run.usage.inputTokens
    totalOut += run.usage.outputTokens

    if (run.error) {
      console.log(`  ERROR: ${run.error}\n`)
      continue
    }

    totalVerified += run.verified.length
    totalRejected += run.rejected.length

    for (const v of run.verified) {
      // Prove the offsets resolve by rendering from the document, not from
      // the model's string. This is how the UI will do it.
      const fromDocument = row.rawText.slice(v.quoteCharStart, v.quoteCharEnd)
      const drifted = fromDocument !== v.quote

      console.log(`  ✓ [${v.issueTag}] ${v.candidateName}  (${v.attribution}, conf ${v.confidence})`)
      console.log(`    position: ${v.positionText.slice(0, 90)}`)
      console.log(`    rung=${v.rung} offsets=${v.quoteCharStart}..${v.quoteCharEnd}`)
      console.log(`    from document: "${fromDocument.slice(0, 100)}"`)
      if (drifted) {
        console.log(`    model returned: "${v.quote.slice(0, 100)}"`)
        console.log(`    ^ the model's string differed; the document is what renders`)
      }
    }

    for (const r of run.rejected) {
      console.log(`  ✗ REJECTED [${r.insight.issueTag}] ${r.reason}`)
      console.log(`    claimed quote: "${r.insight.quote.slice(0, 100)}"`)
    }

    if (run.verified.length === 0 && run.rejected.length === 0) {
      console.log("  (no quotable positions)")
    }
    console.log()
  }

  const total = totalVerified + totalRejected
  console.log("─".repeat(60))
  console.log(`verified ${totalVerified}, rejected ${totalRejected}` + (total > 0 ? ` (${Math.round((totalRejected / total) * 100)}% rejection rate)` : ""))
  console.log(`tokens: ${totalIn.toLocaleString()} in, ${totalOut.toLocaleString()} out`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
