/**
 * Post-migration backfill for 0003.
 *
 *   npm run backfill
 *
 * The migration deliberately leaves two things to code:
 *
 *   1. Speaker identity. The matching rules are lib/speakers/normalize.ts, and
 *      a SQL translation of them would drift from the real function on the
 *      first title nobody thought of. This resolves every existing candidate
 *      to a speaker and points their insights at it.
 *   2. Source diversity. Every row starts at "one source, nothing has checked
 *      it", which is the honest state before a pass has looked. This runs that
 *      pass once over the whole table.
 *
 * Idempotent, and safe to re-run. Neither step ever overwrites a speaker link
 * someone set by hand.
 */

process.loadEnvFile(".env.local")

async function main() {
  const { backfillSpeakers } = await import("../lib/storage/speakers")
  const { recomputeAllCorroboration } = await import("../lib/storage/corroboration")

  console.log("resolving speakers from existing candidates...")
  const speakers = await backfillSpeakers()
  console.log(
    `  ${speakers.speakersResolved} people (${speakers.speakersCreated} newly created), ` +
      `${speakers.candidatesLinked} candidate rows linked, ` +
      `${speakers.insightsLinked} insights linked`,
  )
  console.log(
    "  a ballot has one candidate row per person PER RACE, so far more rows than people",
  )

  console.log("\nscanning for corroborating sources...")
  const corroboration = await recomputeAllCorroboration()
  const multi = corroboration.updated.filter((u) => u.count > 1).length
  console.log(
    `  scanned ${corroboration.scanned}, wrote ${corroboration.linksWritten} links, ` +
      `${multi} insights confirmed by more than one source`,
  )

  console.log("\ndone. Timelines are at /api/v1/speakers/<id>/timeline")
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })

export {}
