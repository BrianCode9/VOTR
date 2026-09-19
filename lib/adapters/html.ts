import { extractArticleText } from "./article-text"
import type { SourceAdapter } from "./registry"
import type { AdapterRun, MediaType, NormalizedDocument, SourceType } from "./types"
import { documentId, publishedSince, safeHostname } from "./types"

/**
 * The generic page scraper: any URL not covered by RSS or GDELT.
 *
 * This is the fallback that keeps the source list open. A campaign's press
 * release page, a city council agenda, a single article someone submitted
 * through "add a source" - all of them come in through here, and none of them
 * need a new adapter written.
 *
 * It shares extractArticleText with the other two adapters on purpose. The RSS
 * and GDELT adapters differ from this one only in how they DISCOVER urls, not
 * in how they read them, and a second reader would mean two different rawText
 * normalizations and therefore two incompatible offset spaces.
 */

export interface HtmlPageInput {
  url: string
  /** Defaults to the hostname. */
  sourceName?: string
  title?: string
  publishedAt?: Date | null
  mediaType?: MediaType
  /** Community submissions carry the submitter's session id. */
  submittedByUser?: string
  /**
   * Set for anything the team generated rather than fetched from a publisher.
   * The card component renders a badge off this and an unlabeled synthetic
   * document is the worst bug this app can ship.
   */
  isSynthetic?: boolean
  /** Merged into rawMetadata, so a caller can carry its own provenance. */
  metadata?: Record<string, unknown>
}

export interface HtmlOptions {
  timeoutMs?: number
  /** Stored as source_type. "user" for community submissions. */
  sourceType?: SourceType
}

/** Scrape one page into a document. */
export async function fetchHtmlPage(
  input: HtmlPageInput | string,
  options: HtmlOptions = {},
): Promise<AdapterRun> {
  const page: HtmlPageInput = typeof input === "string" ? { url: input } : input
  const { timeoutMs = 20_000, sourceType = "html" } = options

  const url = page.url.trim()
  if (!url) return { documents: [], failures: [{ url: "(empty)", reason: "no url given" }] }

  const article = await extractArticleText(url, timeoutMs)
  if (!article.ok) {
    return { documents: [], failures: [{ url, reason: article.error }] }
  }

  return {
    documents: [
      {
        id: documentId(url),
        sourceUrl: url,
        sourceType,
        sourceName: page.sourceName ?? safeHostname(url),
        title: page.title ?? article.value.title ?? url,
        // A date the caller states beats a date guessed from the page markup.
        publishedAt: page.publishedAt ?? article.value.publishedAt,
        fetchedAt: new Date(),
        rawText: article.value.text,
        mediaType: page.mediaType ?? "article",
        isSynthetic: page.isSynthetic ?? false,
        submittedByUser: page.submittedByUser,
        rawMetadata: {
          scrapedTitle: article.value.title,
          scrapedPublished: article.value.publishedAt?.toISOString() ?? null,
          hostname: safeHostname(url),
          ...page.metadata,
        },
      },
    ],
    failures: [],
  }
}

/** Scrape a list of pages, surviving individual failures. */
export async function fetchHtmlPages(
  inputs: (HtmlPageInput | string)[],
  options: HtmlOptions = {},
): Promise<AdapterRun> {
  const documents: NormalizedDocument[] = []
  const failures: AdapterRun["failures"] = []

  for (const input of inputs) {
    const run = await fetchHtmlPage(input, options)
    documents.push(...run.documents)
    failures.push(...run.failures)
  }

  return { documents, failures }
}

export interface HtmlAdapterConfig {
  /**
   * Pages to scrape. A function is allowed so the page list can come from the
   * database (community submissions) rather than being fixed at build time.
   */
  pages: (HtmlPageInput | string)[] | ((since: Date | null) => Promise<(HtmlPageInput | string)[]>)
  id?: string
  label?: string
  sourceType?: SourceType
  timeoutMs?: number
}

/** Build a registrable adapter over an arbitrary set of pages. */
export function htmlAdapter(config: HtmlAdapterConfig): SourceAdapter {
  return {
    id: config.id ?? "html",
    label: config.label ?? "Generic page scraper",
    sourceType: config.sourceType ?? "html",
    async fetch(since) {
      const pages =
        typeof config.pages === "function" ? await config.pages(since) : config.pages

      const run = await fetchHtmlPages(pages, {
        timeoutMs: config.timeoutMs,
        sourceType: config.sourceType,
      })

      return { documents: publishedSince(run.documents, since), failures: run.failures }
    },
  }
}
