import type Anthropic from "@anthropic-ai/sdk"
import { registry } from "../adapters"
import type { NormalizedDocument } from "../adapters/types"
import { confidenceThresholdsFromEnv, type ConfidenceThresholds } from "../confidence/score"
import { extractInsights, type RejectedItem } from "../extract/extract"
import type { VerifyOptions } from "../extract/verify"
import type { FlagOptions } from "../flags/assign"
import { loadPriorStancesForDocument } from "../queries/prior-stances"
import { rewriteAll, type RewriteOptions, type RewriteOutcome } from "../rewrite/rewrite"
import type { VerifiedItem } from "../schemas/insight"
import { ensureDemoRace } from "../storage/ballot"
import { corroborateDocument } from "../storage/corroboration"
import { loadDocument, storeDocuments } from "../storage/documents"
import { logRejections, persistVerified } from "../storage/insights"
import { topicVocabulary } from "../topics/taxonomy"
import { dedupeVerified, type DroppedItem } from "./dedup"

/**
 * The pipeline.
 *
 * adapters -> extraction -> verification -> dedup -> rewrite -> storage, in
 * that order, with each stage importing only the one before it. This module is
 * the only place that knows the order; nothing else reaches across a boundary.
 *
 * The rewrite sits where it does for a reason. It runs after dedup so that a
 * card about to be collapsed never costs a model call, and after verification
 * so it only ever restates a span that provably exists in the source. It is
 * also the one stage whose failure is not the pipeline's failure: a document
 * whose rewrites all fail still persists every insight it found.
 *
 * Two entry points:
 *   ingest()          pull documents from registered adapters and store them
 *   processDocument() extract, verify, dedup, and persist one stored document
 *
 * They are separate because ingestion is cheap and repeatable while extraction
 * costs a model call per document. Pulling a feed should never be gated on
 * having an API key, and re-running extraction should never re-crawl the web.
 */

export interface IngestResult {
  fetched: number
  stored: { id: string; title: string }[]
  skipped: number
  failures: { url: string; reason: string }[]
  byAdapter: Record<string, number>
}

/** Step 1: pull from the registry and store raw documents. */
export async function ingest(
  since: Date | null = null,
  adapterIds?: string[],
): Promise<IngestResult> {
  const run = await registry.fetchAll(since, adapterIds)
  const { stored, skipped } = await storeDocuments(run.documents)

  return {
    fetched: run.documents.length,
    stored,
    skipped,
    failures: run.failures,
    byAdapter: run.byAdapter,
  }
}

export interface ProcessResult {
  documentId: string
  title: string
  verified: VerifiedItem[]
  /** Quotes that could not be located. Logged, never rendered. */
  rejected: RejectedItem[]
  /** Same-kind duplicates collapsed before insert. */
  deduped: DroppedItem[]
  inserted: number
  /** Rows the dedup index already held, i.e. this document was processed before. */
  duplicates: number
  stanceLinks: number
  /** insight_topics rows written. */
  topicLinks: number
  /** Tags the model proposed that are not in the taxonomy. Dropped, not stored. */
  unknownTopics: string[]
  /** How many insights got a usable plain-language rewrite. */
  rewritten: number
  /** Rewrites that failed, with the reason. Never blocks an insight. */
  rewriteFailures: { headline: string; reason: string }[]
  /** Rows stored as `nudge_verify`: the quote supports the claim only weakly. */
  lowConfidence: number
  /**
   * Insights whose source-diversity count changed because of this document,
   * including ones in OTHER documents that this one corroborated.
   */
  corroborated: number
  priorStanceCount: number
  speakers: string[]
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number }
  error?: string
}

export interface ProcessOptions {
  client?: Anthropic
  raceId?: string
  verify?: VerifyOptions
  /** Skip persistence and report what would have been written. */
  dryRun?: boolean
  /**
   * Skip the plain-language rewrite pass.
   *
   * Worth setting when re-running extraction over documents whose rewrites are
   * already stored, since the rewrite is a model call per insight and its
   * output does not change when the extraction does.
   */
  skipRewrite?: boolean
  rewrite?: RewriteOptions
  /** Threshold overrides for flag assignment. */
  flagOptions?: FlagOptions
  /** Cut points for the confidence label. Defaults to the environment. */
  confidenceThresholds?: ConfidenceThresholds
  /**
   * Skip the corroboration pass.
   *
   * Worth setting when replaying a large backlog, where one full
   * `npm run corroborate` at the end is cheaper than a pass per document.
   * The counts are stale until that run, never wrong: an insight nothing has
   * scanned reads as one source, which is what it is.
   */
  skipCorroboration?: boolean
}

/**
 * Step 2: one document, end to end.
 *
 * The order of the first two awaits matters. Prior stances are loaded BEFORE
 * the model call and passed into it, because a stance change the model was not
 * given evidence for is a stance change it invented. When this returns an
 * empty prior-stance list, the prompt tells the model in as many words that
 * stanceChanges must be empty.
 */
export async function processDocument(
  doc: NormalizedDocument,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const base: ProcessResult = {
    documentId: doc.id,
    title: doc.title,
    verified: [],
    rejected: [],
    deduped: [],
    inserted: 0,
    duplicates: 0,
    stanceLinks: 0,
    topicLinks: 0,
    unknownTopics: [],
    rewritten: 0,
    rewriteFailures: [],
    lowConfidence: 0,
    corroborated: 0,
    priorStanceCount: 0,
    speakers: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
  }

  const { speakers, priorStances } = await loadPriorStancesForDocument(doc)

  const run = await extractInsights(doc, {
    client: options.client,
    priorStances,
    knownSpeakers: speakers,
    verify: options.verify,
    // Read from the topics table, not from a constant, so a topic added to
    // the taxonomy is one the extractor can use on the very next document.
    topicVocabulary: await topicVocabulary(),
  })

  if (run.error) {
    return {
      ...base,
      speakers,
      priorStanceCount: priorStances.length,
      usage: run.usage,
      error: run.error,
    }
  }

  const { kept, dropped } = dedupeVerified(run.verified)

  const result: ProcessResult = {
    ...base,
    speakers,
    priorStanceCount: priorStances.length,
    verified: kept,
    rejected: run.rejected,
    deduped: dropped,
    usage: run.usage,
  }

  // The rewrite pass. Runs on the kept items only, and is allowed to fail on
  // any or all of them: every outcome without a summary simply means the card
  // is served with its original quote and no restatement.
  let rewrites: Map<VerifiedItem, RewriteOutcome> | undefined
  const rewriteFailures: { headline: string; reason: string }[] = []

  if (!options.skipRewrite && kept.length > 0) {
    const batch = await rewriteAll(kept, doc, {
      client: options.client,
      ...options.rewrite,
    })
    rewrites = batch.outcomes
    result.rewritten = batch.succeeded
    result.usage = {
      inputTokens: result.usage.inputTokens + batch.usage.inputTokens,
      outputTokens: result.usage.outputTokens + batch.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens + batch.usage.cacheReadTokens,
    }

    for (const [item, outcome] of batch.outcomes) {
      if (!outcome.summary) {
        rewriteFailures.push({ headline: item.headline, reason: outcome.reason ?? "unknown" })
      }
    }
    result.rewriteFailures = rewriteFailures
  }

  if (options.dryRun) return result

  const raceId = options.raceId ?? (await ensureDemoRace())
  const persisted = await persistVerified(doc.id, kept, {
    raceId,
    rewrites,
    flagOptions: options.flagOptions,
    confidenceThresholds: options.confidenceThresholds ?? confidenceThresholdsFromEnv(),
  })

  // Everything the ladder threw away is logged, including the duplicates, so
  // the failure log accounts for every item the model produced.
  await logRejections(doc.id, [
    ...run.rejected.map((r) => ({ reason: `quote failed verification: ${r.reason}` })),
    ...dropped.map((d) => ({ reason: `collapsed as duplicate: ${d.reason}` })),
  ])

  // Source diversity, incrementally. Runs after the insert because it scans
  // rows, including this document's own, and only looks at insights sharing a
  // speaker and a topic with one of them - never the whole table.
  //
  // Its failure is not the document's failure. An insight with a stale count
  // reads as coming from one source, which is the honest default and exactly
  // what it said a moment ago; losing the whole document over it would be the
  // worse trade.
  let corroborated = 0
  if (!options.skipCorroboration) {
    try {
      const run = await corroborateDocument(doc.id)
      corroborated = run.updated.length
    } catch (e) {
      console.error(`corroboration pass failed for document ${doc.id}`, e)
    }
  }

  return {
    ...result,
    inserted: persisted.inserted.length,
    duplicates: persisted.duplicates,
    stanceLinks: persisted.links,
    topicLinks: persisted.topicLinks,
    unknownTopics: persisted.unknownTopics,
    rewritten: persisted.rewritten,
    lowConfidence: persisted.lowConfidence,
    corroborated,
  }
}

/** Load a stored document by id and process it. */
export async function processStoredDocument(
  documentId: string,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const doc = await loadDocument(documentId)
  if (!doc) {
    return {
      documentId,
      title: "(not found)",
      verified: [],
      rejected: [],
      deduped: [],
      inserted: 0,
      duplicates: 0,
      stanceLinks: 0,
      topicLinks: 0,
      unknownTopics: [],
      rewritten: 0,
      rewriteFailures: [],
      lowConfidence: 0,
      corroborated: 0,
      priorStanceCount: 0,
      speakers: [],
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      error: `no document with id ${documentId}`,
    }
  }
  return processDocument(doc, options)
}

/**
 * Process several documents in sequence.
 *
 * Sequential, not parallel, and deliberately so: each document's prior-stance
 * lookup must see the insights written by the documents before it, or two
 * articles in the same batch about the same person will each be compared
 * against a history that is missing the other.
 */
export async function processDocuments(
  docs: NormalizedDocument[],
  options: ProcessOptions = {},
): Promise<ProcessResult[]> {
  const raceId = options.raceId ?? (options.dryRun ? undefined : await ensureDemoRace())
  const results: ProcessResult[] = []

  for (const doc of docs) {
    results.push(await processDocument(doc, { ...options, raceId }))
  }

  return results
}
