import Parser from "rss-parser"
import { extractArticleText, parseDate } from "./article-text"
import type { AdapterRun, Document } from "./types"

const parser = new Parser({ timeout: 15_000 })

export interface RssOptions {
  /** Cap on articles pulled per feed. Feeds can be long and extraction is slow. */
  limit?: number
  /** Overrides the feed's own title as the stored source name. */
  sourceName?: string
  /** Per-article extraction timeout. */
  timeoutMs?: number
}

/**
 * Fetch one RSS feed and pull full article text for each entry.
 *
 * Every article is extracted independently and a failure is recorded rather
 * than thrown, so one dead link, one paywall, or one malformed page cannot take
 * down the rest of the feed. That requirement comes from CLAUDE.md: the
 * ingestion pipeline must survive a single bad document without dying.
 */
export async function fetchRssFeed(
  feedUrl: string,
  options: RssOptions = {},
): Promise<AdapterRun> {
  const { limit = 25, timeoutMs = 20_000 } = options

  const documents: Document[] = []
  const failures: { url: string; reason: string }[] = []

  let feed: Awaited<ReturnType<typeof parser.parseURL>>
  try {
    feed = await parser.parseURL(feedUrl)
  } catch (e) {
    // A feed that will not parse at all is one failure, not a crash.
    return {
      documents,
      failures: [{ url: feedUrl, reason: e instanceof Error ? e.message : String(e) }],
    }
  }

  const sourceName = options.sourceName ?? feed.title ?? safeHostname(feedUrl)
  const items = (feed.items ?? []).slice(0, limit)

  for (const item of items) {
    const url = item.link?.trim()
    if (!url) {
      failures.push({ url: "(missing link)", reason: "feed item had no link" })
      continue
    }

    const article = await extractArticleText(url, timeoutMs)
    if (!article.ok) {
      failures.push({ url, reason: article.error })
      continue
    }

    documents.push({
      url,
      sourceType: "rss",
      sourceName,
      title: article.value.title || item.title?.trim() || url,
      // The feed's own date is more trustworthy than a date scraped from the page.
      publishedAt: parseDate(item.isoDate ?? item.pubDate) ?? article.value.publishedAt,
      rawText: article.value.text,
      mediaType: "article",
      isSynthetic: false,
    })
  }

  return { documents, failures }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
