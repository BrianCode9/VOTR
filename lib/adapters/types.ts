/**
 * The one shape every source adapter emits.
 *
 * RSS, GDELT, and transcripts all normalize to this before anything downstream
 * sees them. Adding a source means adding a file that produces Document[], and
 * changing nothing else in the pipeline.
 */

export type MediaType = "article" | "transcript"
export type SourceType = "rss" | "gdelt" | "transcript" | "user"

export interface Document {
  url: string
  imageUrl?: string
  sourceType: SourceType
  sourceName: string
  title: string
  publishedAt: Date | null
  /**
   * Full source text, stored verbatim and never modified after this point.
   *
   * Quote offsets are computed against this exact string. Trimming, collapsing
   * whitespace, or re-fetching it later invalidates every offset that points
   * into it. Whatever an adapter puts here is what gets written to the database
   * and what verification measures against.
   */
  rawText: string
  mediaType: MediaType
  /** Transcripts only. */
  durationSeconds?: number
  /** Renders a visible badge in the card component. Never silently false. */
  isSynthetic: boolean
  /** session_id of a community submitter, for "add a source". */
  submittedByUser?: string
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
  documents: Document[]
  failures: { url: string; reason: string }[]
}
