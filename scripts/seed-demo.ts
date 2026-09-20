/**
 * Install the demo fixtures.
 *
 *   npm run seed:demo             add them, leave everything else alone
 *   npm run seed:demo -- --reset  delete them first, then add them
 *   npm run seed:demo -- --clear  delete them and stop
 *
 * Exists so the frontend can be built and demoed against data that does not
 * move between two page loads, with no model call, no crawl, and nobody's
 * laptop needing to be awake. `POST /api/v1/dev/seed` is the same thing over
 * HTTP, for someone who has the app running but not a terminal in this repo.
 *
 * Safe against the shared database: every row it touches is reachable from a
 * fixture document URL or a fixture speaker. See lib/fixtures/seed.ts.
 */

process.loadEnvFile(".env.local")

async function main() {
  const args = process.argv.slice(2)
  const reset = args.includes("--reset")
  const clear = args.includes("--clear")

  const { resetDemoData, seedDemoData, demoDataSummary } = await import("../lib/fixtures/seed")

  if (clear) {
    const result = await resetDemoData({ seed: false })
    console.log(
      `removed ${result.deletedDocuments} fixture documents and ` +
        `${result.deletedSpeakers} fixture speakers`,
    )
    return
  }

  const before = await demoDataSummary()
  console.log(
    `fixtures before: ${before.documents}/${before.expected.documents} documents, ` +
      `${before.insights}/${before.expected.insights} insights`,
  )

  const result = reset ? await resetDemoData() : await seedDemoData()

  if (reset && "deletedDocuments" in result) {
    console.log(`reset: removed ${result.deletedDocuments} documents`)
  }

  console.log(
    `seeded ${result.speakers} speakers, ${result.documents} documents, ` +
      `${result.insights} insights, ${result.topicLinks} topic tags`,
  )
  console.log(
    `corroboration: ${result.corroborationLinks} links, ` +
      `${result.corroborated} insights now confirmed by more than one source`,
  )
  console.log("\nfeed:      curl 'http://localhost:3000/api/v1/feed?limit=5'")
  console.log("speakers:  curl 'http://localhost:3000/api/v1/speakers'")
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
