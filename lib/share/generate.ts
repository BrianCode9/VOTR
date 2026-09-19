import { and, eq, sql } from "drizzle-orm"
import { db, hasDatabase } from "@/db"
import { candidates, documents, insights, shareImages } from "@/db/schema"
import type { InsightFlag } from "../flags/types"
import { svgShareRenderer, type ShareCardData, type ShareRenderer } from "./template"

/**
 * Share card generation.
 *
 * Two properties this module holds:
 *
 * 1. Generation is a pure function of (insight, template), so the result is
 *    cached by that pair and a second share of the same card is a single
 *    indexed read rather than a re-render. That cache is also the rate limit:
 *    the expensive path runs once per card, not once per share, no matter how
 *    many people press the button.
 * 2. The quote on the card is sliced out of the stored document at the
 *    verified offsets, exactly as the feed does it. A share card is the one
 *    artifact of this app that travels without its context, so it is the last
 *    place a quote should come from anywhere but the source of truth.
 */

export interface ShareImage {
  id: string
  insightId: string
  template: string
  contentType: string
  encoding: "utf8" | "base64"
  body: string
  width: number
  height: number
  /** Path the image is served at. Relative, so it works on any host. */
  url: string
  /** False when this call rendered it, true when it came from the cache. */
  cached: boolean
}

/** The active renderer. Swap it here; nothing else names a template. */
const defaultRenderer: ShareRenderer = svgShareRenderer

export function shareImageUrl(id: string, contentType: string): string {
  return `/api/share/${id}${extensionFor(contentType)}`
}

function extensionFor(contentType: string): string {
  if (contentType === "image/svg+xml") return ".svg"
  if (contentType === "image/png") return ".png"
  if (contentType === "image/jpeg") return ".jpg"
  return ""
}

/* ---------------------------------------------------------- the data --- */

/**
 * Everything the card shows, in one query.
 *
 * Returns null for an insight that does not exist, and also for one whose
 * stored span no longer fits its document - the same guard the feed applies.
 * A share card with a half-sliced quote on it is worse than no card, because
 * it is the artifact that gets screenshotted and passed on.
 */
export async function loadShareCardData(insightId: string): Promise<ShareCardData | null> {
  if (!hasDatabase) return null

  const [row] = await db
    .select({
      id: insights.id,
      plainLanguage: insights.plainLanguage,
      plainLanguageSummary: insights.plainLanguageSummary,
      issueTag: insights.issueTag,
      flags: insights.flags,
      quoteCharStart: insights.quoteCharStart,
      quoteCharEnd: insights.quoteCharEnd,
      rawTextLength: sql<number>`length(${documents.rawText})`,
      quote: sql<string>`substring(${documents.rawText} from ${insights.quoteCharStart} + 1
                                   for ${insights.quoteCharEnd} - ${insights.quoteCharStart})`,
      sourceName: documents.sourceName,
      candidateName: candidates.name,
    })
    .from(insights)
    .innerJoin(documents, eq(insights.documentId, documents.id))
    .leftJoin(candidates, eq(insights.candidateId, candidates.id))
    .where(eq(insights.id, insightId))
    .limit(1)

  if (!row) return null
  if (row.quoteCharEnd > row.rawTextLength || row.quoteCharEnd <= row.quoteCharStart) {
    return null
  }

  return {
    insightId: row.id,
    plainLanguage: row.plainLanguage,
    plainLanguageSummary: row.plainLanguageSummary,
    quote: row.quote,
    sourceName: row.sourceName,
    candidateName: row.candidateName,
    flags: (row.flags ?? []) as InsightFlag[],
    issueTag: row.issueTag,
  }
}

/* ------------------------------------------------------- generation --- */

export interface GenerateOptions {
  renderer?: ShareRenderer
  /** Re-render even when a cached image exists. For template development. */
  force?: boolean
}

/**
 * Get or create the share card for an insight.
 *
 * Returns null when the insight does not exist or cannot be rendered safely,
 * which the route turns into a 404. Everything else - including a repeat
 * request for a card that already exists - succeeds.
 */
export async function generateShareImage(
  insightId: string,
  options: GenerateOptions = {},
): Promise<ShareImage | null> {
  const renderer = options.renderer ?? defaultRenderer

  if (!options.force) {
    const cached = await readCached(insightId, renderer.template)
    if (cached) return cached
  }

  const data = await loadShareCardData(insightId)
  if (!data) return null

  const rendered = await renderer.render(data)

  const [row] = await db
    .insert(shareImages)
    .values({
      insightId,
      template: renderer.template,
      contentType: rendered.contentType,
      encoding: rendered.encoding,
      body: rendered.body,
      width: rendered.width,
      height: rendered.height,
    })
    // Two concurrent shares of the same card render twice and store once,
    // which is the right trade: rendering is cheap and locking is not.
    .onConflictDoUpdate({
      target: [shareImages.insightId, shareImages.template],
      set: {
        body: rendered.body,
        contentType: rendered.contentType,
        encoding: rendered.encoding,
        width: rendered.width,
        height: rendered.height,
      },
    })
    .returning({ id: shareImages.id })

  return {
    id: row.id,
    insightId,
    template: renderer.template,
    contentType: rendered.contentType,
    encoding: rendered.encoding,
    body: rendered.body,
    width: rendered.width,
    height: rendered.height,
    url: shareImageUrl(row.id, rendered.contentType),
    cached: false,
  }
}

async function readCached(insightId: string, template: string): Promise<ShareImage | null> {
  if (!hasDatabase) return null

  const [row] = await db
    .select()
    .from(shareImages)
    .where(and(eq(shareImages.insightId, insightId), eq(shareImages.template, template)))
    .limit(1)

  if (!row) return null

  return {
    id: row.id,
    insightId: row.insightId,
    template: row.template,
    contentType: row.contentType,
    encoding: row.encoding as "utf8" | "base64",
    body: row.body,
    width: row.width,
    height: row.height,
    url: shareImageUrl(row.id, row.contentType),
    cached: true,
  }
}

/** Fetch a stored image by its own id, for the serving route. */
export async function getShareImage(id: string): Promise<ShareImage | null> {
  if (!hasDatabase) return null

  const [row] = await db.select().from(shareImages).where(eq(shareImages.id, id)).limit(1)
  if (!row) return null

  return {
    id: row.id,
    insightId: row.insightId,
    template: row.template,
    contentType: row.contentType,
    encoding: row.encoding as "utf8" | "base64",
    body: row.body,
    width: row.width,
    height: row.height,
    url: shareImageUrl(row.id, row.contentType),
    cached: true,
  }
}

/** The bytes to serve, whichever encoding the renderer used. */
export function shareImageBytes(image: ShareImage): Buffer {
  return Buffer.from(image.body, image.encoding === "base64" ? "base64" : "utf8")
}
