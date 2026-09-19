/**
 * Read the feed data layer from the command line, without the UI.
 *
 *   npm run feed
 *   npm run feed -- --sort relevant --limit 5
 *   npm run feed -- --topics housing,climate --cardTypes stance_change
 *   npm run feed -- --flags FLIP_FLOP,NEW
 *   npm run feed -- --for housing,climate     boost these topics, as a reader would
 *   npm run feed -- --for housing --strict    filter to them instead of boosting
 *   npm run feed -- --source <insight-id>     print the "see original" payload
 *
 * Exists so the data layer can be checked on its own. Pages twice by default
 * and reports whether the second page overlaps the first, which is the failure
 * an OFFSET-based feed hides.
 */

process.loadEnvFile(".env.local")

async function main() {
  const args = process.argv.slice(2)
  const { getInsightFeed } = await import("../lib/queries/feed")
  const { getSourceContext } = await import("../lib/queries/source-context")

  const insightId = valueOf(args, "--source")
  if (insightId) {
    const context = await getSourceContext(insightId)
    if (!context) {
      console.error(`no insight with id ${insightId}`)
      process.exit(1)
    }
    console.log(`${context.documentTitle}  (${context.sourceName})`)
    console.log(context.sourceUrl)
    console.log(
      `\ncard: ${context.cardType}  verified: ${context.quoteVerified}` +
        `  span: ${context.span.start}..${context.span.end}` +
        `  document: ${context.rawText.length} chars\n`,
    )
    console.log("excerpt with the highlight marked:\n")
    const { text, highlightStart, highlightEnd } = context.excerpt
    console.log(
      text.slice(0, highlightStart) +
        "\u001b[43m\u001b[30m" +
        text.slice(highlightStart, highlightEnd) +
        "\u001b[0m" +
        text.slice(highlightEnd),
    )
    return
  }

  const query = {
    limit: Number(valueOf(args, "--limit") ?? 5),
    sort: (valueOf(args, "--sort") === "relevant" ? "relevant" : "recent") as
      | "relevant"
      | "recent",
    topics: csv(valueOf(args, "--topics")),
    cardTypes: csv(valueOf(args, "--cardTypes")) as never,
    flags: csv(valueOf(args, "--flags")) as never,
    selectedTopics: csv(valueOf(args, "--for")),
    topicMode: (args.includes("--strict") ? "strict" : "boost") as "strict" | "boost",
  }

  if (query.selectedTopics.length > 0) {
    console.log(
      `personalized for [${query.selectedTopics.join(", ")}] in ${query.topicMode} mode\n`,
    )
  }

  const first = await getInsightFeed(query)
  console.log(`sort: ${first.sort}   page 1: ${first.items.length} cards\n`)
  for (const item of first.items) print(item)

  if (!first.nextCursor) {
    console.log("\nno second page: that is the whole feed.")
    return
  }

  const second = await getInsightFeed({ ...query, cursor: first.nextCursor })
  console.log(`\npage 2: ${second.items.length} cards\n`)
  for (const item of second.items) print(item)

  // The property a cursor exists to hold.
  const firstIds = new Set(first.items.map((i) => i.id))
  const overlap = second.items.filter((i) => firstIds.has(i.id))
  console.log(
    overlap.length === 0
      ? "\npages do not overlap"
      : `\nWARNING: ${overlap.length} card(s) appear on both pages`,
  )
}

function print(item: {
  id: string
  cardType: string
  issueTag: string
  topics: string[]
  flags: string[]
  quoteVerified: string
  candidateName: string | null
  headline: string
  plainLanguageSummary: string | null
  quote: string
  span: { start: number; end: number }
  alsoCited: { id: string }[]
  relevanceScore: number
  matchesInterests: boolean
}) {
  const badges = item.flags.length > 0 ? `  [${item.flags.join("] [")}]` : ""
  const boosted = item.matchesInterests ? "  ★" : ""
  console.log(
    `[${item.cardType}] [${item.topics.join("+")}] ${item.candidateName ?? "unattributed"}` +
      `  score ${item.relevanceScore.toFixed(3)}  quote ${item.quoteVerified}${badges}${boosted}`,
  )
  console.log(`  ${truncate(item.headline, 92)}`)
  // The rewrite next to the quote it restates, which is the pair the card
  // shows. A dash means the rewrite has not run or did not produce one.
  console.log(`  plain: ${item.plainLanguageSummary ? truncate(item.plainLanguageSummary, 85) : "—"}`)
  console.log(`  "${truncate(item.quote, 92)}"  @${item.span.start}..${item.span.end}`)
  if (item.alsoCited.length > 0) {
    console.log(`  collapsed ${item.alsoCited.length} other card(s) on this quote`)
  }
  console.log(`  id ${item.id}`)
  console.log()
}

function csv(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
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
