import { eq, sql } from "drizzle-orm"
import { db, hasDatabase } from "@/db"
import { candidates, documents, insights } from "@/db/schema"
import type { CardType } from "../schemas/insight"
import type { QuoteVerification } from "./feed"

/**
 * "See original": everything needed to show an insight inside its document.
 *
 * This is the endpoint the app's entire claim rests on. It returns the stored
 * document text, not a re-fetch of the URL, because a publisher who edits
 * their page would otherwise break both the highlight and the argument. The
 * span is recomputed from the stored offsets at read time and checked against
 * the text, so a context that cannot be highlighted is reported as such rather
 * than rendered as an empty selection.
 */

export interface SourceContext {
  insightId: string
  cardType: CardType
  headline: string
  plainLanguage: string
  issueTag: string
  candidateName: string | null

  documentId: string
  sourceUrl: string
  sourceName: string
  documentTitle: string
  publishedAt: Date | null
  fetchedAt: Date
  isSynthetic: boolean
  mediaType: "article" | "transcript"

  /** The full stored document. The highlight offsets index into this string. */
  rawText: string
  /** Inclusive start, exclusive end, into rawText. */
  span: { start: number; end: number }
  /** rawText.slice(span.start, span.end), computed server-side. */
  quote: string
  quoteVerified: QuoteVerification
  quoteSimilarity: number | null

  /**
   * The document already split at the highlight, so a renderer does not have
   * to redo the offset arithmetic and cannot get it wrong.
   */
  segments: { before: string; highlight: string; after: string }

  /** A paragraph-sized window around the quote, for a compact preview. */
  excerpt: { text: string; start: number; end: number; highlightStart: number; highlightEnd: number }

  /** Transcripts only: the moment to jump to. */
  timestamp: { start: number; end: number } | null
}

/** How much text to include on each side of the quote in the excerpt. */
const EXCERPT_PADDING = 600

export async function getSourceContext(insightId: string): Promise<SourceContext | null> {
  if (!hasDatabase) return null

  const [row] = await db
    .select({
      id: insights.id,
      cardType: insights.cardType,
      headline: insights.positionText,
      plainLanguage: insights.plainLanguage,
      issueTag: insights.issueTag,
      quoteCharStart: insights.quoteCharStart,
      quoteCharEnd: insights.quoteCharEnd,
      quoteVerified: insights.quoteVerified,
      quoteSimilarity: insights.quoteSimilarity,
      timestampStart: insights.timestampStart,
      timestampEnd: insights.timestampEnd,
      candidateName: candidates.name,
      documentId: documents.id,
      sourceUrl: documents.url,
      sourceName: documents.sourceName,
      documentTitle: documents.title,
      publishedAt: documents.publishedAt,
      fetchedAt: documents.fetchedAt,
      isSynthetic: documents.isSynthetic,
      mediaType: documents.mediaType,
      rawText: documents.rawText,
    })
    .from(insights)
    .innerJoin(documents, eq(insights.documentId, documents.id))
    .leftJoin(candidates, eq(insights.candidateId, candidates.id))
    .where(eq(insights.id, insightId))
    .limit(1)

  if (!row) return null

  const rawText = row.rawText
  // Clamp rather than trust. The offsets were verified when written, but this
  // is the one read where a mismatch would be visible to a user as a garbled
  // highlight, so it is re-checked here too.
  const start = Math.max(0, Math.min(row.quoteCharStart, rawText.length))
  const end = Math.max(start, Math.min(row.quoteCharEnd, rawText.length))

  const excerptStart = Math.max(0, start - EXCERPT_PADDING)
  const excerptEnd = Math.min(rawText.length, end + EXCERPT_PADDING)

  return {
    insightId: row.id,
    cardType: row.cardType,
    headline: row.headline,
    plainLanguage: row.plainLanguage,
    issueTag: row.issueTag,
    candidateName: row.candidateName,

    documentId: row.documentId,
    sourceUrl: row.sourceUrl,
    sourceName: row.sourceName,
    documentTitle: row.documentTitle,
    publishedAt: row.publishedAt,
    fetchedAt: row.fetchedAt,
    isSynthetic: row.isSynthetic,
    mediaType: row.mediaType,

    rawText,
    span: { start, end },
    quote: rawText.slice(start, end),
    quoteVerified: row.quoteVerified,
    quoteSimilarity: row.quoteSimilarity,

    segments: {
      before: rawText.slice(0, start),
      highlight: rawText.slice(start, end),
      after: rawText.slice(end),
    },

    excerpt: {
      text: rawText.slice(excerptStart, excerptEnd),
      start: excerptStart,
      end: excerptEnd,
      highlightStart: start - excerptStart,
      highlightEnd: end - excerptStart,
    },

    timestamp:
      row.timestampStart !== null && row.timestampEnd !== null
        ? { start: row.timestampStart, end: row.timestampEnd }
        : null,
  }
}

/**
 * Every insight drawn from one document, for a source-level view.
 *
 * Ordered by position in the text so the list reads down the document rather
 * than in extraction order.
 */
export async function getDocumentInsights(documentId: string) {
  if (!hasDatabase) return []

  return db
    .select({
      id: insights.id,
      cardType: insights.cardType,
      headline: insights.positionText,
      issueTag: insights.issueTag,
      span: sql<string>`json_build_object('start', ${insights.quoteCharStart},
                                          'end', ${insights.quoteCharEnd})`,
      quoteVerified: insights.quoteVerified,
    })
    .from(insights)
    .where(eq(insights.documentId, documentId))
    .orderBy(insights.quoteCharStart)
}
