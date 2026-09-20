import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { insightTopics, insights, rejections, stanceLinks } from "@/db/schema"
import { confidenceFields, type ConfidenceThresholds } from "../confidence/score"
import { assignFlags, primaryFlag, type FlagOptions } from "../flags/assign"
import { checkClaim, type FactCheckProvider } from "../flags/fact-check"
import type { FactCheckStatus, InsightFlag } from "../flags/types"
import { existingHistoryPairs, historyKey } from "../queries/history"
import type { VerifiedItem } from "../schemas/insight"
import { relevanceScore } from "../pipeline/relevance"
import { resolveTopicSlugs, topicIdsForSlugs } from "../topics/taxonomy"
import type { RewriteOutcome } from "../rewrite/rewrite"
import { resolveCandidate } from "./ballot"

/**
 * Insight persistence.
 *
 * Only VerifiedItem reaches this module. There is no code path that writes an
 * insight from an unverified quote, and the offsets columns are NOT NULL so
 * there is no shape a failed verification could take here even by accident.
 * Failures go to `rejections`, which is a log, not a feed.
 */

export interface PersistOptions {
  /** Race that candidate names resolve within. */
  raceId: string
  /**
   * Rows land as `published` and the verification judge re-routes them later.
   * Set this to stage a run behind the judge instead.
   */
  status?: "published" | "verify_yourself"
  /**
   * Plain-language rewrites, keyed by the item they belong to.
   *
   * Optional, and an absent or failed entry is not an error: the column is
   * nullable and every read path falls back to the quote. See lib/rewrite.
   */
  rewrites?: Map<VerifiedItem, RewriteOutcome>
  /** Threshold overrides for flag assignment. */
  flagOptions?: FlagOptions
  /**
   * Cut points for the confidence label. Defaults to the environment, which
   * defaults to lib/confidence/score.ts.
   *
   * Passed in rather than read here so that one persist call cannot be
   * labelled by one threshold pair and the next by another mid-run: the
   * pipeline resolves it once and hands the same object down.
   */
  confidenceThresholds?: ConfidenceThresholds
  /** Override the registered fact-check provider, for tests. */
  factCheckProvider?: FactCheckProvider
}

export interface PersistResult {
  inserted: { id: string; cardType: string; flags: InsightFlag[] }[]
  /** How many rows landed as `nudge_verify`, i.e. low claim support. */
  lowConfidence: number
  /** Rows the dedup index already had. Re-running a document is idempotent. */
  duplicates: number
  links: number
  /** insight_topics rows written. */
  topicLinks: number
  /** Tags the model produced that are not in the taxonomy. Logged, not stored. */
  unknownTopics: string[]
  /** How many items got a usable plain-language rewrite. */
  rewritten: number
}

/** A row's identity within one document, matching the dedup index. */
function rowKey(item: {
  cardType: string
  quoteCharStart: number
  quoteCharEnd: number
}): string {
  return `${item.cardType}:${item.quoteCharStart}:${item.quoteCharEnd}`
}

export async function persistVerified(
  documentId: string,
  items: VerifiedItem[],
  options: PersistOptions,
): Promise<PersistResult> {
  const empty: PersistResult = {
    inserted: [],
    lowConfidence: 0,
    duplicates: 0,
    links: 0,
    topicLinks: 0,
    unknownTopics: [],
    rewritten: 0,
  }
  if (items.length === 0) return empty

  // Resolve every distinct speaker once rather than per item.
  const names = [...new Set(items.map((i) => i.candidateName).filter((n): n is string => !!n))]
  const resolved = new Map<string, { candidateId: string; speakerId: string | null }>()
  for (const name of names) {
    resolved.set(name, await resolveCandidate(options.raceId, name))
  }

  const candidateIdFor = (item: VerifiedItem): string | null =>
    item.candidateName ? (resolved.get(item.candidateName)?.candidateId ?? null) : null

  const speakerIdFor = (item: VerifiedItem): string | null =>
    item.candidateName ? (resolved.get(item.candidateName)?.speakerId ?? null) : null

  const { topicsByItem, unknownTopics } = await resolveItemTopics(items)
  const factChecks = await checkFactualClaims(items, options.factCheckProvider)
  const flagsByItem = await assignFlagsForBatch(items, {
    documentId,
    candidateIdFor,
    factChecks,
    flagOptions: options.flagOptions,
  })

  const rows = items.map((item) => {
    const rewrite = options.rewrites?.get(item)
    const flags = flagsByItem.get(item) ?? []
    // The label, the verify-yourself flag, and the presentation mode are
    // derived together from one score so a row cannot be stored labelled
    // `low` and presented as `stated`. See lib/confidence/score.ts.
    const confidence = confidenceFields(item.claimSupportConfidence, options.confidenceThresholds)

    return {
      documentId,
      candidateId: candidateIdFor(item),
      speakerId: speakerIdFor(item),
      cardType: item.cardType,
      issueTag: item.topic,
      positionText: item.headline,
      plainLanguage: item.plainLanguage,
      // Null when the rewrite pass did not run or did not produce something
      // usable. Never a fallback copy of plainLanguage: a caller has to be
      // able to tell "not rewritten" from "rewritten", and a silent copy
      // would make the rewrite's success rate unmeasurable.
      plainLanguageSummary: rewrite?.summary ?? null,
      readingLevelEstimate: rewrite?.readingLevel ?? null,
      payload: item.payload,
      quoteCharStart: item.quoteCharStart,
      quoteCharEnd: item.quoteCharEnd,
      quoteVerified: item.quoteVerified,
      quoteSimilarity: item.similarity,
      attribution: item.attribution,
      flag: primaryFlag(flags),
      flags,
      factCheckStatus: factChecks.get(item)?.status ?? ("unresolved" as const),
      factCheckSource: factChecks.get(item)?.source ?? null,
      factCheckedAt: factChecks.get(item) ? new Date() : null,
      extractorConfidence: item.confidence,
      claimSupportConfidence: confidence.claimSupportConfidence,
      confidenceLabel: confidence.confidenceLabel,
      verifyYourself: confidence.verifyYourself,
      presentationMode: confidence.presentationMode,
      judgeRating: null,
      relevanceScore: relevanceScore(item),
      status: options.status ?? ("published" as const),
    }
  })

  const inserted = await db
    .insert(insights)
    .values(rows)
    // The unique dedup index makes a re-run a no-op instead of a second card.
    .onConflictDoNothing({
      target: [
        insights.documentId,
        insights.quoteCharStart,
        insights.quoteCharEnd,
        insights.cardType,
      ],
    })
    .returning({
      id: insights.id,
      cardType: insights.cardType,
      quoteCharStart: insights.quoteCharStart,
      quoteCharEnd: insights.quoteCharEnd,
    })

  // Topic links are written against every item, not only the newly inserted
  // ones. On a re-run the insight rows conflict away but their topic rows may
  // be missing - because the taxonomy grew, or because an earlier run predates
  // this table - and converging on a re-run is worth one extra read.
  const idByKey = await idsForDocument(documentId)
  const topicLinks = await linkTopics(items, topicsByItem, idByKey)

  const links = await linkStanceChanges(items, inserted)

  return {
    inserted: inserted.map((r) => ({
      id: r.id,
      cardType: r.cardType,
      flags: flagsForKey(items, flagsByItem, rowKey(r)),
    })),
    lowConfidence: rows.filter((r) => r.verifyYourself).length,
    duplicates: rows.length - inserted.length,
    links,
    topicLinks,
    unknownTopics,
    rewritten: rows.filter((r) => r.plainLanguageSummary !== null).length,
  }
}

function flagsForKey(
  items: VerifiedItem[],
  flagsByItem: Map<VerifiedItem, InsightFlag[]>,
  key: string,
): InsightFlag[] {
  const item = items.find((i) => rowKey(i) === key)
  return item ? (flagsByItem.get(item) ?? []) : []
}

/* --------------------------------------------------------------- flags -- */

/**
 * Assign flags for a whole document's worth of items.
 *
 * The batch matters for NEW. Two cards in one document about the same speaker
 * and topic are not both the first thing on record; the earlier one in the
 * document is. Asking the database per item would say NEW for both, because
 * neither is written yet, so the pairs this batch has already claimed are
 * tracked locally and folded into the same answer.
 */
async function assignFlagsForBatch(
  items: VerifiedItem[],
  context: {
    documentId: string
    candidateIdFor: (item: VerifiedItem) => string | null
    factChecks: Map<VerifiedItem, { status: FactCheckStatus; source: string }>
    flagOptions?: FlagOptions
  },
): Promise<Map<VerifiedItem, InsightFlag[]>> {
  const pairs = items.flatMap((item) => {
    const candidateId = context.candidateIdFor(item)
    return candidateId ? [{ candidateId, topic: item.topic as string }] : []
  })

  const onRecord = await existingHistoryPairs(pairs, {
    excludeDocumentId: context.documentId,
  })

  const out = new Map<VerifiedItem, InsightFlag[]>()

  for (const item of items) {
    const candidateId = context.candidateIdFor(item)
    const key = candidateId ? historyKey(candidateId, item.topic) : null

    const flags = assignFlags(
      {
        cardType: item.cardType,
        payload: item.payload,
        headline: item.headline,
        confidence: item.confidence,
        candidateName: item.candidateName,
        hasPriorHistory: key ? onRecord.has(key) : false,
        factCheckStatus: context.factChecks.get(item)?.status ?? "unresolved",
      },
      context.flagOptions,
    )

    // Claim the pair so a second card on it in this same document is not NEW.
    if (key) onRecord.add(key)

    out.set(item, flags)
  }

  return out
}

/**
 * Ask the fact-check provider about every factual claim.
 *
 * With the default provider this is a no-op that returns `unresolved` for
 * everything, which is why it is not gated behind a flag or an env var: the
 * call is already free, and wiring a real provider should not require
 * remembering to turn this on.
 */
async function checkFactualClaims(
  items: VerifiedItem[],
  provider?: FactCheckProvider,
): Promise<Map<VerifiedItem, { status: FactCheckStatus; source: string }>> {
  const out = new Map<VerifiedItem, { status: FactCheckStatus; source: string }>()

  for (const item of items) {
    if (item.payload.cardType !== "factual_claim") continue
    const verdict = await checkClaim(item.headline, { provider })
    out.set(item, { status: verdict.status, source: verdict.source })
  }

  return out
}

/* -------------------------------------------------------------- topics -- */

/** Validate each item's proposed tags against the taxonomy table. */
async function resolveItemTopics(
  items: VerifiedItem[],
): Promise<{ topicsByItem: Map<VerifiedItem, string[]>; unknownTopics: string[] }> {
  const topicsByItem = new Map<VerifiedItem, string[]>()
  const unknown = new Set<string>()

  for (const item of items) {
    const resolved = await resolveTopicSlugs(item.topics.length > 0 ? item.topics : [item.topic])
    for (const slug of resolved.unknown) unknown.add(slug)
    // The primary tag is enum-constrained, so it resolves unless someone
    // renamed a taxonomy row out from under it. If everything dropped, the
    // card still exists with its issue_tag; it just has no join rows.
    topicsByItem.set(item, resolved.known)
  }

  return { topicsByItem, unknownTopics: [...unknown] }
}

/** Every insight row in this document, keyed the way items are. */
async function idsForDocument(documentId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({
      id: insights.id,
      cardType: insights.cardType,
      quoteCharStart: insights.quoteCharStart,
      quoteCharEnd: insights.quoteCharEnd,
    })
    .from(insights)
    .where(eq(insights.documentId, documentId))

  return new Map(rows.map((r) => [rowKey(r), r.id]))
}

async function linkTopics(
  items: VerifiedItem[],
  topicsByItem: Map<VerifiedItem, string[]>,
  idByKey: Map<string, string>,
): Promise<number> {
  const slugs = [...new Set([...topicsByItem.values()].flat())]
  if (slugs.length === 0) return 0

  const idBySlug = await topicIdsForSlugs(slugs)

  const rows: { insightId: string; topicId: string; primary: boolean }[] = []
  for (const item of items) {
    const insightId = idByKey.get(rowKey(item))
    if (!insightId) continue

    for (const slug of topicsByItem.get(item) ?? []) {
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

/**
 * Attach the rewrite to an insight that is already stored.
 *
 * The pipeline writes rewrites with the row, but a backfill over rows that
 * predate the rewrite pass needs this. Returns false when the id is gone,
 * rather than throwing: a backfill should skip a deleted row, not stop.
 */
export async function updatePlainLanguageSummary(
  insightId: string,
  outcome: { summary: string | null; readingLevel: number | null },
): Promise<boolean> {
  const updated = await db
    .update(insights)
    .set({
      plainLanguageSummary: outcome.summary,
      readingLevelEstimate: outcome.readingLevel,
    })
    .where(eq(insights.id, insightId))
    .returning({ id: insights.id })

  return updated.length > 0
}

/**
 * Record a fact-check verdict against a stored claim, and re-derive the badge.
 *
 * UNVERIFIED_CLAIM is the one flag that can legitimately change after write,
 * because it is the one that depends on the outside world rather than on what
 * the document said. NEW and FLIP_FLOP are left exactly as they were.
 */
export async function applyFactCheck(
  insightId: string,
  verdict: { status: FactCheckStatus; source: string },
): Promise<boolean> {
  const [row] = await db
    .select({
      flags: insights.flags,
      cardType: insights.cardType,
      payload: insights.payload,
    })
    .from(insights)
    .where(and(eq(insights.id, insightId), eq(insights.cardType, "factual_claim")))
    .limit(1)

  if (!row) return false

  const payload = row.payload as { checkability?: string }
  const stillUnverified =
    payload.checkability !== "easily_checkable" || verdict.status === "unresolved"

  const others = (row.flags as InsightFlag[]).filter((f) => f !== "UNVERIFIED_CLAIM")
  const flags = stillUnverified ? [...others, "UNVERIFIED_CLAIM" as const] : others

  await db
    .update(insights)
    .set({
      factCheckStatus: verdict.status,
      factCheckSource: verdict.source,
      factCheckedAt: new Date(),
      flags,
      flag: primaryFlag(flags),
    })
    .where(eq(insights.id, insightId))

  return true
}

/**
 * Record which prior insight a stance change was measured against.
 *
 * The model is asked to copy the id out of the prior-stances block it was
 * given, and that id is checked against the table before it is stored. An id
 * the model invented links to nothing and is dropped silently: the card still
 * stands on its own verified quote, it just loses its "compared against" edge.
 */
async function linkStanceChanges(
  items: VerifiedItem[],
  inserted: { id: string; cardType: string; quoteCharStart: number }[],
): Promise<number> {
  const changes = items.filter(
    (item) => item.payload.cardType === "stance_change" && item.payload.priorInsightId,
  )
  if (changes.length === 0) return 0

  const priorIds = [
    ...new Set(
      changes.map((c) =>
        c.payload.cardType === "stance_change" ? c.payload.priorInsightId! : "",
      ),
    ),
  ].filter((id) => UUID_RE.test(id))
  if (priorIds.length === 0) return 0

  const existing = await db
    .select({ id: insights.id })
    .from(insights)
    .where(inArray(insights.id, priorIds))
  const real = new Set(existing.map((r) => r.id))

  // Match each inserted row back to its item by the span, which is unique per
  // card type within a document by the dedup index.
  const byStart = new Map(
    inserted.filter((r) => r.cardType === "stance_change").map((r) => [r.quoteCharStart, r.id]),
  )

  const links = changes.flatMap((item) => {
    if (item.payload.cardType !== "stance_change") return []
    const priorInsightId = item.payload.priorInsightId
    const insightId = byStart.get(item.quoteCharStart)
    if (!insightId || !priorInsightId || !real.has(priorInsightId)) return []
    return [{ insightId, priorInsightId, relation: "contradicts" }]
  })

  if (links.length === 0) return 0
  await db.insert(stanceLinks).values(links)
  return links.length
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The public failure log.
 *
 * Every quote the ladder could not place is written here with its reason. An
 * app whose whole claim is traceability should be able to show what it threw
 * away, and a rising rejection rate is the earliest signal that the prompt has
 * drifted.
 */
export async function logRejections(
  documentId: string,
  entries: { reason: string }[],
): Promise<number> {
  if (entries.length === 0) return 0
  await db
    .insert(rejections)
    .values(entries.map((e) => ({ documentId, reason: e.reason })))
  return entries.length
}
