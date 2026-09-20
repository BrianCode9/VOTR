import { eq, inArray, like, sql } from "drizzle-orm"
import { db, hasDatabase } from "@/db"
import {
  candidates,
  documents,
  insightTopics,
  insights,
  speakers,
} from "@/db/schema"
import { confidenceFields } from "../confidence/score"
import { recomputeAllCorroboration } from "../storage/corroboration"
import { ensureDemoRace } from "../storage/ballot"
import { aliasSet, normalizeSpeakerName } from "../speakers/normalize"
import { topicIdsForSlugs } from "../topics/taxonomy"
import {
  DEMO_DOCUMENTS,
  DEMO_INSIGHTS,
  DEMO_SPEAKERS,
  DEMO_URL_PREFIX,
  type DemoInsight,
} from "./demo-data"

/**
 * Installing and removing the demo dataset.
 *
 * The one rule that makes this safe to point at the shared database: every row
 * it writes is reachable from a document whose URL starts with
 * DEMO_URL_PREFIX, or from a speaker named in DEMO_SPEAKERS. A reset deletes
 * exactly those and lets the foreign keys cascade. Nothing here truncates a
 * table, and nothing here touches a row it did not create.
 *
 * The second rule is in the offsets. Fixture quotes are declared as strings
 * and located with indexOf at seed time, never written down as numbers. An
 * insight whose quote is not a literal substring of its document throws, by
 * name, rather than being stored with a plausible-looking span that renders as
 * a fragment of the wrong sentence. That is the same property the real
 * pipeline enforces with the verification ladder, held here by a different
 * mechanism because there is no model call to verify.
 */

export interface SeedResult {
  speakers: number
  documents: number
  insights: number
  topicLinks: number
  corroborationLinks: number
  /** Insights whose source-diversity count is above 1 after seeding. */
  corroborated: number
  reset: boolean
}

export interface ResetResult extends SeedResult {
  deletedDocuments: number
  deletedSpeakers: number
}

/** Does the fixture set exist, and what is in it? Writes nothing. */
export async function demoDataSummary(): Promise<{
  installed: boolean
  documents: number
  insights: number
  speakers: number
  expected: { documents: number; insights: number; speakers: number }
  urlPrefix: string
}> {
  const expected = {
    documents: DEMO_DOCUMENTS.length,
    insights: DEMO_INSIGHTS.length,
    speakers: DEMO_SPEAKERS.length,
  }

  if (!hasDatabase) {
    return { installed: false, documents: 0, insights: 0, speakers: 0, expected, urlPrefix: DEMO_URL_PREFIX }
  }

  const docs = await db
    .select({ id: documents.id })
    .from(documents)
    .where(like(documents.url, `${DEMO_URL_PREFIX}%`))

  const ids = docs.map((d) => d.id)
  const rows = ids.length
    ? await db.select({ id: insights.id }).from(insights).where(inArray(insights.documentId, ids))
    : []

  const people = await db
    .select({ id: speakers.id })
    .from(speakers)
    .where(inArray(speakers.normalizedName, DEMO_SPEAKERS.map((s) => normalizeSpeakerName(s.name))))

  return {
    installed: docs.length === expected.documents,
    documents: docs.length,
    insights: rows.length,
    speakers: people.length,
    expected,
    urlPrefix: DEMO_URL_PREFIX,
  }
}

/**
 * Install the fixtures, leaving everything else alone.
 *
 * Idempotent. Documents upsert on their URL, insights fall through the
 * existing (document, span, card type) dedup index, and topic links fall
 * through theirs, so a second run converges instead of duplicating.
 */
export async function seedDemoData(): Promise<SeedResult> {
  if (!hasDatabase) {
    throw new Error("DATABASE_URL is not set. Run `npm run setup` before seeding.")
  }

  const raceId = await ensureDemoRace()
  const speakerIds = await upsertSpeakers(raceId)
  const documentIds = await upsertDocuments()
  const { inserted, topicLinks } = await upsertInsights(speakerIds, documentIds, raceId)

  // Run the real matcher over the seeded rows rather than writing counts by
  // hand. A fixture with hand-written corroboration counts would keep looking
  // right after a change to the matcher broke it, which is the opposite of
  // what fixtures are for.
  const corroboration = await recomputeAllCorroboration()

  return {
    speakers: speakerIds.size,
    documents: documentIds.size,
    insights: inserted,
    topicLinks,
    corroborationLinks: corroboration.linksWritten,
    corroborated: corroboration.updated.filter((u) => u.count > 1).length,
    reset: false,
  }
}

/**
 * Delete the fixture rows and, by default, install them again.
 *
 * `seed: false` removes them and stops, which is the DELETE endpoint.
 *
 * Deleting the documents cascades to their insights, topic links,
 * corroboration links, saves, share images, reactions, and rejections, which
 * is exactly the set this fixture created. The speakers are removed separately
 * because nothing cascades to them; their `speaker_id` references are ON
 * DELETE SET NULL precisely so a person can be removed without taking a real
 * insight with them.
 */
export async function resetDemoData(
  options: { seed?: boolean } = {},
): Promise<ResetResult> {
  if (!hasDatabase) {
    throw new Error("DATABASE_URL is not set. Run `npm run setup` before seeding.")
  }

  const deletedDocs = await db
    .delete(documents)
    .where(like(documents.url, `${DEMO_URL_PREFIX}%`))
    .returning({ id: documents.id })

  const normalized = DEMO_SPEAKERS.map((s) => normalizeSpeakerName(s.name))

  // Candidate rows first: they reference the speaker, and the demo race is
  // created fresh by ensureDemoRace on the next seed anyway.
  const speakerRows = await db
    .select({ id: speakers.id })
    .from(speakers)
    .where(inArray(speakers.normalizedName, normalized))

  if (speakerRows.length > 0) {
    await db
      .delete(candidates)
      .where(inArray(candidates.speakerId, speakerRows.map((s) => s.id)))
  }

  const deletedSpeakers = await db
    .delete(speakers)
    .where(inArray(speakers.normalizedName, normalized))
    .returning({ id: speakers.id })

  if (options.seed === false) {
    return {
      speakers: 0,
      documents: 0,
      insights: 0,
      topicLinks: 0,
      corroborationLinks: 0,
      corroborated: 0,
      reset: true,
      deletedDocuments: deletedDocs.length,
      deletedSpeakers: deletedSpeakers.length,
    }
  }

  const seeded = await seedDemoData()
  return {
    ...seeded,
    reset: true,
    deletedDocuments: deletedDocs.length,
    deletedSpeakers: deletedSpeakers.length,
  }
}

/* ------------------------------------------------------------ writers -- */

async function upsertSpeakers(raceId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>()

  for (const person of DEMO_SPEAKERS) {
    const normalizedName = normalizeSpeakerName(person.name)
    const aliases = aliasSet([person.name, ...person.aliases])

    const [row] = await db
      .insert(speakers)
      .values({
        name: person.name,
        normalizedName,
        normalizedAliases: aliases,
        party: person.party,
        role: person.role,
      })
      .onConflictDoUpdate({
        target: speakers.normalizedName,
        set: {
          name: person.name,
          normalizedAliases: aliases,
          party: person.party,
          role: person.role,
          updatedAt: new Date(),
        },
      })
      .returning({ id: speakers.id })

    ids.set(person.key, row.id)

    // A candidate row per person, so the demo ballot has people on it and the
    // existing candidate-scoped code paths have something to resolve.
    const [existing] = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(sql`${candidates.raceId} = ${raceId} and ${candidates.name} = ${person.name}`)
      .limit(1)

    if (existing) {
      await db
        .update(candidates)
        .set({ speakerId: row.id, party: person.party })
        .where(eq(candidates.id, existing.id))
    } else {
      await db.insert(candidates).values({
        raceId,
        name: person.name,
        party: person.party,
        incumbent: false,
        speakerId: row.id,
      })
    }
  }

  return ids
}

async function upsertDocuments(): Promise<Map<string, string>> {
  const ids = new Map<string, string>()

  for (const doc of DEMO_DOCUMENTS) {
    const url = `${DEMO_URL_PREFIX}${doc.slug}`

    // rawText is deliberately NOT updated on conflict. Insight offsets index
    // into this exact string, and re-seeding over an edited fixture would
    // leave every stored span pointing into text that has moved underneath it.
    // Changing a fixture document means running a reset, not a re-seed.
    const [row] = await db
      .insert(documents)
      .values({
        url,
        sourceType: "user",
        sourceName: doc.sourceName,
        title: doc.title,
        publishedAt: new Date(doc.publishedAt),
        rawText: doc.text,
        mediaType: doc.mediaType,
        isSynthetic: true,
        rawMetadata: { fixture: doc.key },
      })
      .onConflictDoUpdate({
        target: documents.url,
        set: { title: doc.title, sourceName: doc.sourceName },
      })
      .returning({ id: documents.id })

    ids.set(doc.key, row.id)
  }

  return ids
}

async function upsertInsights(
  speakerIds: Map<string, string>,
  documentIds: Map<string, string>,
  raceId: string,
): Promise<{ inserted: number; topicLinks: number }> {
  const textByKey = new Map(DEMO_DOCUMENTS.map((d) => [d.key, d.text]))
  const candidateIds = await candidateIdsByName(raceId)

  const rows = DEMO_INSIGHTS.map((item) => {
    const documentId = documentIds.get(item.documentKey)
    const text = textByKey.get(item.documentKey)
    if (!documentId || !text) {
      throw new Error(`fixture insight references unknown document "${item.documentKey}"`)
    }

    const span = locate(item, text)
    const confidence = confidenceFields(item.claimSupportConfidence)
    const person = item.speakerKey
      ? DEMO_SPEAKERS.find((s) => s.key === item.speakerKey)
      : undefined

    return {
      documentId,
      candidateId: person ? (candidateIds.get(person.name) ?? null) : null,
      speakerId: item.speakerKey ? (speakerIds.get(item.speakerKey) ?? null) : null,
      cardType: item.cardType,
      issueTag: item.topic,
      positionText: item.headline,
      plainLanguage: item.plainLanguage,
      plainLanguageSummary: item.plainLanguageSummary,
      readingLevelEstimate: item.plainLanguageSummary ? 7 : null,
      payload: item.payload,
      quoteCharStart: span.start,
      quoteCharEnd: span.end,
      quoteVerified: item.quoteVerified,
      quoteSimilarity: item.quoteSimilarity,
      attribution: item.attribution,
      flag: item.flags[0] ?? null,
      flags: item.flags,
      factCheckStatus: item.factCheckStatus,
      factCheckSource: item.factCheckSource,
      factCheckedAt: item.factCheckStatus === "unresolved" ? null : new Date(),
      extractorConfidence: item.confidence,
      claimSupportConfidence: confidence.claimSupportConfidence,
      confidenceLabel: confidence.confidenceLabel,
      verifyYourself: confidence.verifyYourself,
      presentationMode: confidence.presentationMode,
      relevanceScore: 0.5,
      status: "published" as const,
    }
  })

  await db
    .insert(insights)
    .values(rows)
    .onConflictDoNothing({
      target: [
        insights.documentId,
        insights.quoteCharStart,
        insights.quoteCharEnd,
        insights.cardType,
      ],
    })

  const topicLinks = await linkTopics(documentIds)

  return { inserted: rows.length, topicLinks }
}

/**
 * Find the quote in the document, or refuse to seed.
 *
 * Two failures are caught here and both are fatal on purpose. A quote that is
 * not in the text would be stored with an invented span; a quote that appears
 * twice would be stored pointing at whichever copy came first, and "see
 * original" would highlight a passage the fixture did not mean. Both would
 * survive every type check and only show up as a garbled card in a demo.
 */
function locate(item: DemoInsight, text: string): { start: number; end: number } {
  const start = text.indexOf(item.quote)
  if (start < 0) {
    throw new Error(
      `fixture quote is not in "${item.documentKey}": ${JSON.stringify(item.quote.slice(0, 60))}`,
    )
  }

  if (text.indexOf(item.quote, start + 1) >= 0) {
    throw new Error(
      `fixture quote appears more than once in "${item.documentKey}", so its span is ` +
        `ambiguous: ${JSON.stringify(item.quote.slice(0, 60))}`,
    )
  }

  return { start, end: start + item.quote.length }
}

async function candidateIdsByName(raceId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: candidates.id, name: candidates.name })
    .from(candidates)
    .where(eq(candidates.raceId, raceId))

  return new Map(rows.map((r) => [r.name, r.id]))
}

/**
 * Mirror each fixture insight's tags into insight_topics.
 *
 * Read back by (document, span, card type) rather than tracked from the insert
 * because the insert is a conflict-do-nothing: on a re-seed it returns nothing
 * and the ids have to come from the table either way.
 */
async function linkTopics(documentIds: Map<string, string>): Promise<number> {
  const slugs = [...new Set(DEMO_INSIGHTS.flatMap((i) => i.topics))]
  const idBySlug = await topicIdsForSlugs(slugs)
  if (idBySlug.size === 0) return 0

  const docIds = [...documentIds.values()]
  if (docIds.length === 0) return 0

  const stored = await db
    .select({
      id: insights.id,
      documentId: insights.documentId,
      cardType: insights.cardType,
      quoteCharStart: insights.quoteCharStart,
    })
    .from(insights)
    .where(inArray(insights.documentId, docIds))

  const byKey = new Map(
    stored.map((r) => [`${r.documentId}:${r.cardType}:${r.quoteCharStart}`, r.id]),
  )
  const textByKey = new Map(DEMO_DOCUMENTS.map((d) => [d.key, d.text]))

  const rows: { insightId: string; topicId: string; primary: boolean }[] = []
  for (const item of DEMO_INSIGHTS) {
    const documentId = documentIds.get(item.documentKey)
    const text = textByKey.get(item.documentKey)
    if (!documentId || !text) continue

    const insightId = byKey.get(
      `${documentId}:${item.cardType}:${locate(item, text).start}`,
    )
    if (!insightId) continue

    for (const slug of item.topics) {
      const topicId = idBySlug.get(slug)
      if (!topicId) continue
      rows.push({ insightId, topicId, primary: slug === item.topic })
    }
  }

  if (rows.length === 0) return 0

  const written = await db
    .insert(insightTopics)
    .values(rows)
    .onConflictDoNothing({ target: [insightTopics.insightId, insightTopics.topicId] })
    .returning({ insightId: insightTopics.insightId })

  return written.length
}
