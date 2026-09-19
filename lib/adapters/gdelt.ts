import { extractArticleText } from "./article-text"
import type { AdapterRun, Document, FetchResult } from "./types"
import { err, ok } from "./types"

const GDELT_DOC_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc"

/** GDELT caps artlist responses at 250 records regardless of what you ask for. */
const MAX_RECORDS = 250

/** One row of GDELT's artlist response. GDELT returns metadata only, no text. */
export interface GdeltArticle {
  url: string
  title: string
  seendate: string
  domain: string
  language: string
  sourcecountry: string
}

export interface GdeltQuery {
  /** GDELT query string, e.g. `"jane doe" sourcelang:english`. */
  query: string
  /** Relative window, e.g. "7d", "24h". Mutually exclusive with start/end. */
  timespan?: string
  startDatetime?: string // YYYYMMDDHHMMSS
  endDatetime?: string
  maxRecords?: number
}

/**
 * Thin fetch wrapper over the GDELT Document 2.0 API.
 *
 * Plain HTTP JSON, no key, no client library, per the spec. GDELT returns
 * article metadata only, so turning these into Documents requires a second
 * pass that fetches each URL's text, see fetchGdeltDocuments below.
 */
export async function searchGdelt(
  params: GdeltQuery,
  signal?: AbortSignal,
): Promise<FetchResult<GdeltArticle[]>> {
  const url = new URL(GDELT_DOC_ENDPOINT)
  url.searchParams.set("query", params.query)
  url.searchParams.set("mode", "artlist")
  url.searchParams.set("format", "json")
  url.searchParams.set(
    "maxrecords",
    String(Math.min(params.maxRecords ?? 75, MAX_RECORDS)),
  )

  if (params.startDatetime && params.endDatetime) {
    url.searchParams.set("startdatetime", params.startDatetime)
    url.searchParams.set("enddatetime", params.endDatetime)
  } else {
    url.searchParams.set("timespan", params.timespan ?? "7d")
  }

  let res: Response
  try {
    res = await fetch(url, { signal, headers: { "user-agent": "VOTR/0.1" } })
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }

  if (!res.ok) return err(`GDELT returned ${res.status} ${res.statusText}`)

  // GDELT answers a malformed query with HTTP 200 and a plain-text error body,
  // so Content-Type and JSON.parse are both unreliable on their own. Read the
  // body once as text and decide from there.
  const body = await res.text()
  if (!body.trim().startsWith("{")) {
    return err(`GDELT rejected the query: ${body.trim().slice(0, 200)}`)
  }

  try {
    const parsed = JSON.parse(body) as { articles?: GdeltArticle[] }
    return ok(parsed.articles ?? [])
  } catch {
    return err(`GDELT returned unparseable JSON: ${body.slice(0, 200)}`)
  }
}

/**
 * Search GDELT, then pull full text for each hit.
 *
 * Volume here is high and mostly irrelevant, which is exactly why Nemotron
 * triage sits between this and extraction. Do not remove that step.
 */
export async function fetchGdeltDocuments(
  params: GdeltQuery,
  options: { limit?: number; timeoutMs?: number } = {},
): Promise<AdapterRun> {
  const { limit = 25, timeoutMs = 20_000 } = options

  const documents: Document[] = []
  const failures: { url: string; reason: string }[] = []

  const search = await searchGdelt(params)
  if (!search.ok) {
    return { documents, failures: [{ url: GDELT_DOC_ENDPOINT, reason: search.error }] }
  }

  for (const article of search.value.slice(0, limit)) {
    if (!article.url) continue

    const text = await extractArticleText(article.url, timeoutMs)
    if (!text.ok) {
      failures.push({ url: article.url, reason: text.error })
      continue
    }

    documents.push({
      url: article.url,
      sourceType: "gdelt",
      sourceName: article.domain || "gdelt",
      title: text.value.title || article.title || article.url,
      publishedAt: parseSeenDate(article.seendate) ?? text.value.publishedAt,
      rawText: text.value.text,
      mediaType: "article",
      isSynthetic: false,
    })
  }

  return { documents, failures }
}

/** GDELT stamps dates as `20260919T190000Z`, which Date cannot parse directly. */
export function parseSeenDate(seendate: string | undefined): Date | null {
  if (!seendate) return null
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(seendate.trim())
  if (!m) {
    const fallback = new Date(seendate)
    return Number.isNaN(fallback.getTime()) ? null : fallback
  }
  const [, y, mo, d, h, mi, s] = m
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}
