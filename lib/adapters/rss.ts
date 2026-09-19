import Parser from "rss-parser"
import { extractArticleText, parseDate } from "./article-text"
import type { SourceAdapter } from "./registry"
import type { AdapterRun, NormalizedDocument } from "./types"
import { documentId, publishedSince, safeHostname } from "./types"

const parser = new Parser({ timeout: 15_000 })

export interface RssOptions {
  /** Cap on articles pulled per feed. Feeds can be long and extraction is slow. */
  limit?: number
  /** Overrides the feed's own title as the stored source name. */
  sourceName?: string
  /** Per-article extraction timeout. */
  timeoutMs?: number
  /** Skip entries whose feed date is older than this. */
  since?: Date | null
}

/**
 * Fetch one RSS feed and pull full article text for each entry.
 *
 * The RSS summary is deliberately not used as rawText. It is truncated,
 * sometimes rewritten, and quotes extracted from it would point into a body of
 * text that is not what the publisher actually printed. The linked page is
 * fetched and its article body becomes rawText; an entry whose page cannot be
 * read is a failure, not a document built from the summary.
 *
 * Every article is extracted independently and a failure is recorded rather
 * than thrown, so one dead link, one paywall, or one malformed page cannot take
 * down the rest of the feed.
 */
export async function fetchRssFeed(
  feedUrl: string,
  options: RssOptions = {},
): Promise<AdapterRun> {
  const { limit = 25, timeoutMs = 20_000, since = null } = options

  const documents: NormalizedDocument[] = []
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

  // Date-filter on the feed's own metadata BEFORE fetching article bodies.
  // Filtering afterwards would mean paying for a full page fetch per entry to
  // learn we already had it, which on a daily cron is most of the work.
  const items = (feed.items ?? [])
    .filter((item) => {
      if (!since) return true
      const at = parseDate(item.isoDate ?? item.pubDate)
      return !at || at >= since
    })
    .slice(0, limit)

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
      id: documentId(url),
      sourceUrl: url,
      sourceType: "rss",
      sourceName,
      title: article.value.title || item.title?.trim() || url,
      // The feed's own date is more trustworthy than a date scraped from the page.
      publishedAt: parseDate(item.isoDate ?? item.pubDate) ?? article.value.publishedAt,
      fetchedAt: new Date(),
      rawText: article.value.text,
      mediaType: "article",
      isSynthetic: false,
      rawMetadata: {
        feedUrl,
        feedTitle: feed.title ?? null,
        guid: item.guid ?? null,
        creator: item.creator ?? null,
        categories: item.categories ?? [],
        isoDate: item.isoDate ?? null,
        pubDate: item.pubDate ?? null,
        contentSnippet: item.contentSnippet ?? null,
        extractedTitle: article.value.title,
      },
    })
  }

  return { documents, failures }
}

export interface RssAdapterConfig {
  /** Feed URLs to pull on every run. */
  feeds: string[]
  id?: string
  label?: string
  limitPerFeed?: number
  timeoutMs?: number
}

/** Build a registrable adapter over a fixed list of feeds. */
export function rssAdapter(config: RssAdapterConfig): SourceAdapter {
  return {
    id: config.id ?? "rss",
    label: config.label ?? `RSS (${config.feeds.length} feeds)`,
    sourceType: "rss",
    async fetch(since) {
      const documents: NormalizedDocument[] = []
      const failures: AdapterRun["failures"] = []

      for (const feedUrl of config.feeds) {
        const run = await fetchRssFeed(feedUrl, {
          limit: config.limitPerFeed,
          timeoutMs: config.timeoutMs,
          since,
        })
        documents.push(...run.documents)
        failures.push(...run.failures)
      }

      return { documents: publishedSince(documents, since), failures }
    },
  }
}
