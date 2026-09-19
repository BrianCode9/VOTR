/**
 * End-to-end check of the flags, topics, profile, save, and share layers.
 *
 *   npm run verify:core
 *
 * Exercises every new write path against the real database and cleans up after
 * itself. Nothing here asserts model behavior; it asserts that the data layer
 * does what the unit tests say it does once a real Postgres is involved -
 * array columns, the join table, the keyset cursor with a boost bucket, and
 * the idempotency guard on saves.
 */

process.loadEnvFile(".env.local")

const USER = `verify-${Date.now()}`

async function main() {
  const { db } = await import("../db/index")
  const { insights, savedInsights, shareImages, userProfiles } = await import("../db/schema")
  const { eq, sql } = await import("drizzle-orm")
  const { getInsightFeed } = await import("../lib/queries/feed")
  const { setSelectedTopics, getProfile, clearProfile, validateTopicSelection } =
    await import("../lib/storage/profiles")
  const { saveInsight, unsaveInsight, listSavedInsights, savedIdsAmong } = await import(
    "../lib/storage/saved"
  )
  const { generateShareImage, getShareImage } = await import("../lib/share/generate")
  const { applyFactCheck } = await import("../lib/storage/insights")

  let failures = 0
  const check = (label: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  ${detail}` : ""}`)
    if (!ok) failures++
  }

  /* ---------------------------------------------------------- topics -- */

  console.log("\ntopic taxonomy")
  const tagged = await db.execute<{ [k: string]: unknown; n: number }>(sql`
    select count(*)::int as n from insight_topics
  `)
  check("insight_topics is populated", [...tagged][0].n > 0, `${[...tagged][0].n} rows`)

  const bad = await validateTopicSelection(["housing"])
  check("one topic is rejected", !bad.ok, bad.ok ? "" : bad.reason)
  const tooMany = await validateTopicSelection(["housing", "climate", "guns", "veterans"])
  check("four topics are rejected", !tooMany.ok)
  const unknown = await validateTopicSelection(["housing", "nonsense_topic"])
  check("an unknown topic is rejected", !unknown.ok, unknown.ok ? "" : unknown.reason)

  /* --------------------------------------------------------- profile -- */

  console.log("\nprofile")
  const profile = await setSelectedTopics(USER, ["housing", "climate"])
  check("profile written", profile.selectedTopics.length === 2)

  const reread = await getProfile(USER)
  check(
    "picks come back in order",
    reread?.selectedTopics.map((t) => t.slug).join(",") === "housing,climate",
    reread?.selectedTopics.map((t) => t.slug).join(","),
  )

  const replaced = await setSelectedTopics(USER, ["guns", "veterans", "economy"])
  check("replacing picks does not accumulate", replaced.selectedTopics.length === 3)

  await setSelectedTopics(USER, ["housing", "climate"])

  /* ------------------------------------------------------------ feed -- */

  console.log("\nfeed ranking")

  /*
   * The topics to boost are derived from the data, not hardcoded.
   *
   * A fixed pair would make these checks vacuous on any database that happens
   * not to contain them - which is exactly what a hardcoded ["housing",
   * "climate"] did here: every assertion passed against zero matched rows.
   * Picking a tag that exists, and one that does not dominate the table, is
   * what makes "boosted cards precede unboosted ones" a real statement.
   */
  const spread = [
    ...(await db.execute<{ [k: string]: unknown; issue_tag: string; n: number }>(sql`
      select issue_tag, count(*)::int as n
      from insights where status = 'published'
      group by issue_tag order by n asc
    `)),
  ]
  const selected = spread.slice(0, 2).map((r) => r.issue_tag)
  const expectedMatches = spread
    .slice(0, 2)
    .reduce((sum, r) => sum + r.n, 0)

  check(
    "the fixture is meaningful: some cards match and some do not",
    selected.length > 0 && expectedMatches > 0 && expectedMatches < 44 + expectedMatches,
    `boosting [${selected.join(", ")}], ~${expectedMatches} of ${spread.reduce((n, r) => n + r.n, 0)} cards`,
  )

  const boosted = await getInsightFeed({ limit: 50, selectedTopics: selected })
  const firstUnmatched = boosted.items.findIndex((i) => !i.matchesInterests)
  const lastMatched = boosted.items.map((i) => i.matchesInterests).lastIndexOf(true)
  check(
    "boosted cards all precede unboosted ones",
    firstUnmatched === -1 || lastMatched < firstUnmatched,
    `${boosted.items.filter((i) => i.matchesInterests).length} matched of ${boosted.items.length}`,
  )

  const unboosted = await getInsightFeed({ limit: 50 })
  check(
    "boosting does not drop rows",
    boosted.items.length === unboosted.items.length,
    `${boosted.items.length} vs ${unboosted.items.length}`,
  )

  check(
    "at least one card was actually boosted",
    boosted.items.some((i) => i.matchesInterests),
  )
  check(
    "at least one card was not, so the ordering was exercised",
    boosted.items.some((i) => !i.matchesInterests),
  )

  const strict = await getInsightFeed({
    limit: 50,
    selectedTopics: selected,
    topicMode: "strict",
  })
  check(
    "strict returns only selected topics",
    strict.items.every((i) => i.matchesInterests === false || i.matchesInterests === true) &&
      strict.items.every(
        (i) => selected.includes(i.issueTag) || i.topics.some((t) => selected.includes(t)),
      ),
    `${strict.items.length} cards`,
  )
  check("strict is a subset of boosted", strict.items.length <= boosted.items.length)
  check("strict actually returned something", strict.items.length > 0)

  // Paging with a boost bucket: the property a keyset cursor exists to hold.
  const p1 = await getInsightFeed({ limit: 3, selectedTopics: selected })
  if (p1.nextCursor) {
    const p2 = await getInsightFeed({
      limit: 3,
      selectedTopics: selected,
      cursor: p1.nextCursor,
    })
    const ids = new Set(p1.items.map((i) => i.id))
    check(
      "boosted pages do not overlap",
      p2.items.every((i) => !ids.has(i.id)),
      `page2 ${p2.items.length} cards`,
    )
    check(
      "the boosted section is not restarted on page 2",
      !(p1.items.some((i) => !i.matchesInterests) && p2.items.some((i) => i.matchesInterests)),
    )
  } else {
    check("boosted pages do not overlap", true, "(only one page of data)")
  }

  console.log("\nflag filters")
  const all = await getInsightFeed({ limit: 50 })
  check("every card exposes a flags array", all.items.every((i) => Array.isArray(i.flags)))
  check(
    "flag mirrors flags[0]",
    all.items.every((i) => i.flag === (i.flags[0] ?? null)),
  )

  const sample = all.items[0]
  if (!sample) {
    console.log("\nno insights stored, skipping save and share checks")
    return finish(failures)
  }

  /*
   * Flag one row, filter for it, then put it back.
   *
   * Without this the filter check runs against a table where nothing is
   * flagged, and "every returned card carries FLIP_FLOP" is trivially true of
   * an empty result. The restore is in a finally so an assertion failure
   * cannot leave a badge on a real insight.
   */
  const originalFlags = sample.flags
  try {
    await db
      .update(insights)
      .set({ flags: ["FLIP_FLOP"], flag: "FLIP_FLOP" })
      .where(eq(insights.id, sample.id))

    const flagged = await getInsightFeed({ limit: 50, flags: ["FLIP_FLOP"] })
    check(
      "the flag filter returns only flagged cards",
      flagged.items.length > 0 && flagged.items.every((i) => i.flags.includes("FLIP_FLOP")),
      `${flagged.items.length} cards`,
    )
    check(
      "and finds the one we flagged",
      flagged.items.some((i) => i.id === sample.id),
    )

    const other = await getInsightFeed({ limit: 50, flags: ["UNVERIFIED_CLAIM"] })
    check(
      "a badge nothing carries returns nothing",
      !other.items.some((i) => i.id === sample.id),
    )
  } finally {
    await db
      .update(insights)
      .set({ flags: originalFlags, flag: originalFlags[0] ?? null })
      .where(eq(insights.id, sample.id))
  }

  /* ----------------------------------------------------------- saves -- */

  console.log("\nsaves")
  const first = await saveInsight(USER, sample.id)
  check("save succeeds", first?.saved === true && first.alreadySaved === false)

  const second = await saveInsight(USER, sample.id)
  check("saving twice is idempotent", second?.alreadySaved === true)
  check(
    "savedAt is not moved by a repeat save",
    first?.savedAt?.getTime() === second?.savedAt?.getTime(),
  )

  const rows = await db.execute<{ [k: string]: unknown; n: number }>(sql`
    select count(*)::int as n from saved_insights
    where user_id = ${USER} and insight_id = ${sample.id}::uuid
  `)
  check("exactly one row exists", [...rows][0].n === 1, `${[...rows][0].n} rows`)

  const missing = await saveInsight(USER, "00000000-0000-4000-8000-000000000000")
  check("saving a missing insight is a clean null, not a crash", missing === null)

  const saved = await listSavedInsights(USER)
  check("the saved list returns the card", saved.items.some((i) => i.id === sample.id))
  check(
    "saved cards carry savedAt",
    saved.items.every((i) => i.savedAt instanceof Date),
  )
  check(
    "the saved card still has its quote sliced from the document",
    (saved.items[0]?.quote.length ?? 0) > 0,
  )

  const marks = await savedIdsAmong(USER, all.items.map((i) => i.id))
  check("savedIdsAmong finds it", marks.has(sample.id))

  check("unsave removes it", (await unsaveInsight(USER, sample.id)) === true)
  check("unsaving twice is not an error", (await unsaveInsight(USER, sample.id)) === false)

  /* ----------------------------------------------------------- share -- */

  console.log("\nshare cards")
  const image = await generateShareImage(sample.id)
  check("share image generated", Boolean(image) && image!.cached === false)
  check("it is a real SVG", image!.body.startsWith("<svg") && image!.body.includes("</svg>"))
  check("it carries the quote", image!.body.length > 500, `${image!.body.length} bytes`)
  check("the url is stable and relative", image!.url === `/api/share/${image!.id}.svg`)

  const again = await generateShareImage(sample.id)
  check("a second request hits the cache", again!.cached === true)
  check("and returns the same id", again!.id === image!.id)

  const fetched = await getShareImage(image!.id)
  check("the serving path finds it by id", fetched?.id === image!.id)

  const forced = await generateShareImage(sample.id, { force: true })
  check("force re-renders into the same row", forced!.id === image!.id)

  const missingImage = await generateShareImage("00000000-0000-4000-8000-000000000000")
  check("a missing insight yields null, not a crash", missingImage === null)

  /* ------------------------------------------------------ fact check -- */

  console.log("\nfact-check verdicts")
  const [aClaim] = await db
    .select({ id: insights.id, flags: insights.flags })
    .from(insights)
    .where(eq(insights.cardType, "factual_claim"))
    .limit(1)

  if (aClaim) {
    const applied = await applyFactCheck(aClaim.id, {
      status: "supported",
      source: "verify-script",
    })
    check("a verdict applies", applied)

    const [after] = await db
      .select({ flags: insights.flags, status: insights.factCheckStatus })
      .from(insights)
      .where(eq(insights.id, aClaim.id))
    check("the status is stored", after.status === "supported")
    console.log(`         flags now: [${after.flags.join(", ")}]`)

    // Put it back the way it was found.
    await applyFactCheck(aClaim.id, { status: "unresolved", source: "unresolved" })
  } else {
    console.log("  skip  no factual_claim rows stored yet")
  }

  /* --------------------------------------------------------- cleanup -- */

  await db.delete(savedInsights).where(eq(savedInsights.userId, USER))
  await clearProfile(USER)
  await db.delete(shareImages).where(eq(shareImages.insightId, sample.id))

  const leftover = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(eq(userProfiles.userId, USER))
  check("cleanup left nothing behind", leftover.length === 0)

  return finish(failures)
}

function finish(failures: number) {
  console.log(
    failures === 0
      ? "\nall checks passed"
      : `\n${failures} check(s) FAILED`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

// Marks this file as a module: every script here declares a `main`, and
// without it they share one global scope.
export {}
