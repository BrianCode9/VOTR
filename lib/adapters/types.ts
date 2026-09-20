/**
 * The one shape every source adapter emits.
 *
 * RSS, GDELT, scraped pages, and transcripts all normalize to this before
 * anything downstream sees them. Adding a source means adding a file that
 * produces NormalizedDocument[], registering it, and changing nothing else in
 * the pipeline.
 */

import { createHash } from "node:crypto"

export type MediaType = "article" | "transcript"
export type SourceType = "rss" | "gdelt" | "html" | "transcript" | "user"

export interface NormalizedDocument {
  /**
   * Deterministic from sourceUrl, see documentId().
   *
   * Stable across runs on purpose: re-fetching the same URL produces the same
   * id, so ingestion is idempotent and an adapter can be re-run without
   * creating a second copy of a document that insights already point into.
   */
  id: string
  sourceName: string
  sourceUrl: string
  /**
   * Full source text, stored verbatim and never modified after this point.
   *
   * Quote offsets are computed against this exact string. Trimming, collapsing
   * whitespace, or re-fetching it later invalidates every offset that points
   * into it. Whatever an adapter puts here is what gets written to the database
   * and what verification measures against.
   */
  rawText: string
  publishedAt: Date | null
  fetchedAt: Date
  /**
   * Adapter-specific fields, preserved exactly as the source gave them.
   *
   * Nothing in the pipeline reads this. It exists so that a field we did not
   * think to normalize is not lost, and so a source can be debugged after the
   * fact without re-fetching a page that may have changed.
   */
  rawMetadata: Record<string, unknown>

  sourceType: SourceType
  title: string
  /** Lead image for the document, when the source exposes one. */
  imageUrl?: string
  mediaType: MediaType
  /** Transcripts only. */
  durationSeconds?: number
  /** Renders a visible badge in the card component. Never silently false. */
  isSynthetic: boolean
  /** session_id of a community submitter, for "add a source". */
  submittedByUser?: string
}

/** @deprecated Use NormalizedDocument. Kept so older imports keep compiling. */
export type Document = NormalizedDocument

/**
 * A UUID derived from the document's URL (RFC 4122 v5 layout, votr namespace).
 *
 * Postgres wants a uuid, and we want the id to be a pure function of the URL
 * rather than whatever the database happened to generate on first insert.
 */
export function documentId(sourceUrl: string): string {
  const digest = createHash("sha1").update(`votr:document:${sourceUrl}`).digest()
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50 // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = Buffer.from(bytes).toString("hex")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-")
}

/**
 * Adapters never throw. The ingestion pipeline has to survive one bad document
 * out of fifty without losing the other forty-nine, so failure is a value.
 */
export type FetchResult<T> = { ok: true; value: T } | { ok: false; error: string }

export function ok<T>(value: T): FetchResult<T> {
  return { ok: true, value }
}

export function err<T>(error: string): FetchResult<T> {
  return { ok: false, error }
}

/** What an adapter returns: the documents it got, plus what it could not get. */
export interface AdapterRun {
  documents: NormalizedDocument[]
  failures: { url: string; reason: string }[]
}

export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/**
 * Drop documents published before `since`.
 *
 * A document with no publish date is KEPT. Most scraped pages have no reliable
 * date, and silently discarding them would make an adapter look broken when it
 * is the page that is thin. Callers that need a hard cutoff can filter on
 * fetchedAt, which is always present.
 */
export function publishedSince(
  documents: NormalizedDocument[],
  since: Date | null,
): NormalizedDocument[] {
  if (!since) return documents
  return documents.filter((d) => !d.publishedAt || d.publishedAt >= since)
}
