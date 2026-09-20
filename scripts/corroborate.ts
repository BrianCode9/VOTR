/**
 * Recompute source-diversity counts.
 *
 *   npm run corroborate                  the whole table
 *   npm run corroborate -- --document <uuid>
 *   npm run corroborate -- --insight <uuid>
 *
 * The pipeline already runs the document form after every ingest, so this is
 * for the one-time backfill after the 0003 migration, for replaying a document
 * whose corroborating articles arrived later, and for catching up after a
 * failed run. `POST /api/v1/jobs/corroborate` is the same thing over HTTP.
 *
 * It never creates, edits, or deletes an insight. The worst a stray run can do
 * is recompute a count to the value it already had.
 */

process.loadEnvFile(".env.local")

async function main() {
  const args = process.argv.slice(2)
  const documentId = valueOf(args, "--document")
  const insightId = valueOf(args, "--insight")

  const { corroborateDocument, recomputeAllCorroboration, recomputeCorroborationFor } =
    await import("../lib/storage/corroboration")

  const scope = documentId ? `document ${documentId}` : insightId ? `insight ${insightId}` : "all published insights"
  console.log(`scanning ${scope}\n`)

  const result = documentId
    ? await corroborateDocument(documentId)
    : insightId
      ? await recomputeCorroborationFor(insightId)
      : await recomputeAllCorroboration()

  for (const update of result.updated) {
    if (update.count <= 1) continue
    console.log(`  ${update.insightId}  ${update.count} sources: ${update.sourceKeys.join(", ")}`)
  }

  const multi = result.updated.filter((u) => u.count > 1).length
  console.log(
    `\nscanned ${result.scanned}, wrote ${result.linksWritten} links, ` +
      `${multi} insights confirmed by more than one source`,
  )
  if (multi === 0 && result.scanned > 0) {
    console.log(
      "nothing corroborated. That is the expected answer when every document " +
        "comes from one outlet, or when no two cover the same person on the same topic.",
    )
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

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })

export {}
