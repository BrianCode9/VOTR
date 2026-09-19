import { extract } from "@extractus/article-extractor"
import { htmlToText } from "./html-to-text"
import type { FetchResult } from "./types"
import { err, ok } from "./types"

/** Below this, an "article" is almost always a paywall or consent interstitial. */
export const MIN_ARTICLE_CHARS = 400

export interface ArticleText {
  title: string | null
  imageUrl: string | null
  text: string
  publishedAt: Date | null
}

/**
 * Pull full article text for one URL. Shared by the RSS and GDELT adapters,
 * which differ only in how they discover URLs, not in how they read them.
 *
 * Returns a result rather than throwing. Callers are iterating over dozens of
 * URLs and one bad host must not end the run.
 */
export async function extractArticleText(
  url: string,
  timeoutMs = 20_000,
): Promise<FetchResult<ArticleText>> {
  try {
    const article = await withTimeout(extract(url), timeoutMs)
    const text = htmlToText(article?.content ?? "")

    if (text.length < MIN_ARTICLE_CHARS) {
      return err(`extracted text too short (${text.length} chars)`)
    }

    return ok({
      title: article?.title?.trim() || null,
      imageUrl: article?.image?.trim() || null,
      text,
      publishedAt: parseDate(article?.published),
    })
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * article-extractor does not reliably honor its own timeout on a hung socket,
 * and one unresponsive host should not stall an entire ingest run.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
