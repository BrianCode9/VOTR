import { desc, eq } from "drizzle-orm"
import { db, hasDatabase } from "@/db"
import { candidates, documents, insights } from "@/db/schema"

/**
 * The feed query.
 *
 * The quote is produced here by slicing the stored document at the verified
 * offsets. It is never read from a stored quote string, because no such column
 * exists. That is the whole design: traceability is a property of the data
 * model rather than a promise from the model.
 *
 * rawText stays on the server. Only the sliced span crosses to the client.
 */

export interface FeedItem {
  id: string
  quote: string
  positionText: string
  plainLanguage: string
  issueTag: string
  attribution: "own_words" | "characterization"
  flag: "NEW" | "FLIP_FLOP" | "UNVERIFIED_CLAIM" | null
  judgeRating: number | null
  candidateName: string
  sourceName: string
  sourceUrl: string
  imageUrl: string | null
  documentTitle: string
  publishedAt: Date | null
  isSynthetic: boolean
  /** Character span in the source document, shown as provenance. */
  span: { start: number; end: number }
}

export async function getFeed(limit = 40): Promise<FeedItem[]> {
  // Someone working on the UI may not be in the Neon org yet. Return an empty
  // feed so the page renders its empty state instead of crashing the dev
  // server with a connection error.
  if (!hasDatabase) return []

  const rows = await db
    .select({
      id: insights.id,
      positionText: insights.positionText,
      plainLanguage: insights.plainLanguage,
      issueTag: insights.issueTag,
      attribution: insights.attribution,
      flag: insights.flag,
      judgeRating: insights.judgeRating,
      quoteCharStart: insights.quoteCharStart,
      quoteCharEnd: insights.quoteCharEnd,
      candidateName: candidates.name,
      sourceName: documents.sourceName,
      sourceUrl: documents.url,
      imageUrl: documents.imageUrl,
      documentTitle: documents.title,
      publishedAt: documents.publishedAt,
      isSynthetic: documents.isSynthetic,
      rawText: documents.rawText,
    })
    .from(insights)
    .innerJoin(documents, eq(insights.documentId, documents.id))
    .innerJoin(candidates, eq(insights.candidateId, candidates.id))
    .where(eq(insights.status, "published"))
    .orderBy(desc(insights.createdAt))
    .limit(limit)

  return rows
    .map((r) => ({
      id: r.id,
      quote: r.rawText.slice(r.quoteCharStart, r.quoteCharEnd),
      positionText: r.positionText,
      plainLanguage: r.plainLanguage,
      issueTag: r.issueTag,
      attribution: r.attribution,
      flag: r.flag,
      judgeRating: r.judgeRating,
      candidateName: r.candidateName,
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
      imageUrl: r.imageUrl,
      documentTitle: r.documentTitle,
      publishedAt: r.publishedAt,
      isSynthetic: r.isSynthetic,
      span: { start: r.quoteCharStart, end: r.quoteCharEnd },
    }))
    // An offset that no longer resolves means the document changed underneath
    // it. Drop the card rather than render an empty highlight.
    .filter((item) => item.quote.trim().length > 0)
}
