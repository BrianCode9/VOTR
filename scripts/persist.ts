/**
 * Extract from stored documents and persist verified insights.
 *
 *   npm run persist
 *   npm run persist -- --limit 6
 *
 * Creates a demo district, race, and candidate rows on demand so the feed has
 * something real to render. Candidate resolution here is by name only; proper
 * address-to-district resolution is build-order step 7.
 *
 * judge_rating stays null until the Nemotron judge exists. Status is set to
 * published so the feed renders, and the judge pass will re-route these rows
 * once it can run.
 */

import { eq, and } from "drizzle-orm"
import { extractInsights } from "../lib/extract/extract"
import type { Document } from "../lib/adapters/types"

process.loadEnvFile(".env.local")

const DEMO = {
  districtType: "congressional",
  districtName: "Demo district",
  state: "US",
  geoId: "DEMO-01",
  office: "U.S. House",
  level: "federal" as const,
}

async function main() {
  const args = process.argv.slice(2)
  const limitIdx = args.indexOf("--limit")
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 6

  const { db } = await import("../db/index")
  const schema = await import("../db/schema")

  // Demo ballot scaffolding, created once.
  let [district] = await db
    .select()
    .from(schema.districts)
    .where(eq(schema.districts.geoId, DEMO.geoId))
  if (!district) {
    ;[district] = await db
      .insert(schema.districts)
      .values({
        type: DEMO.districtType,
        name: DEMO.districtName,
        state: DEMO.state,
        geoId: DEMO.geoId,
      })
      .returning()
  }

  let [race] = await db
    .select()
    .from(schema.races)
    .where(eq(schema.races.districtId, district.id))
  if (!race) {
    ;[race] = await db
      .insert(schema.races)
      .values({
        districtId: district.id,
        office: DEMO.office,
        electionDate: new Date("2026-11-03"),
        level: DEMO.level,
      })
      .returning()
  }

  const rows = await db.select().from(schema.documents).limit(limit)
  console.log(`extracting from ${rows.length} documents\n`)

  let persisted = 0
  let rejected = 0

  for (const row of rows) {
    // Skip documents we have already extracted from, so re-running is cheap.
    const existing = await db
      .select({ id: schema.insights.id })
      .from(schema.insights)
      .where(eq(schema.insights.documentId, row.id))
      .limit(1)
    if (existing.length > 0) {
      console.log(`· already done: ${row.title.slice(0, 60)}`)
      continue
    }

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

    const run = await extractInsights(doc)
    if (run.error) {
      console.log(`! ${row.title.slice(0, 55)}: ${run.error}`)
      continue
    }

    for (const v of run.verified) {
      const candidateId = await resolveCandidate(db, schema, race.id, v.candidateName)

      await db.insert(schema.insights).values({
        documentId: row.id,
        candidateId,
        issueTag: v.issueTag,
        positionText: v.positionText,
        plainLanguage: v.plainLanguage,
        quoteCharStart: v.quoteCharStart,
        quoteCharEnd: v.quoteCharEnd,
        attribution: v.attribution,
        extractorConfidence: v.confidence,
        judgeRating: null,
        status: "published",
      })
      persisted++
    }

    // Every failed quote goes in the public failure log.
    for (const r of run.rejected) {
      await db.insert(schema.rejections).values({
        documentId: row.id,
        reason: `quote failed verification: ${r.reason}`,
      })
      rejected++
    }

    console.log(
      `✓ ${row.title.slice(0, 55)} → ${run.verified.length} kept, ${run.rejected.length} rejected`,
    )
  }

  console.log(`\npersisted ${persisted} insights, logged ${rejected} rejections`)
}

async function resolveCandidate(
  db: Awaited<typeof import("../db/index")>["db"],
  schema: typeof import("../db/schema"),
  raceId: string,
  name: string,
): Promise<string> {
  const [found] = await db
    .select()
    .from(schema.candidates)
    .where(and(eq(schema.candidates.raceId, raceId), eq(schema.candidates.name, name)))
    .limit(1)
  if (found) return found.id

  const [created] = await db
    .insert(schema.candidates)
    .values({ raceId, name, party: null, incumbent: false })
    .returning()
  return created.id
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
