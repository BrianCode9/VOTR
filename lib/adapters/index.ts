import { gdeltAdapter } from "./gdelt"
import { htmlAdapter } from "./html"
import { registry } from "./registry"
import { rssAdapter } from "./rss"

/**
 * The default source set, registered once at import.
 *
 * This file is the only place that knows which concrete adapters exist. The
 * pipeline imports `registry`, never an adapter module, so a new source is a
 * new file plus a register() call here.
 *
 * Lists are overridable from the environment so a demo can be pointed at a
 * different set of sources without a code change:
 *   VOTR_RSS_FEEDS=url,url
 *   VOTR_GDELT_QUERIES=query|query      (pipe separated; queries contain commas)
 *   VOTR_HTML_PAGES=url,url
 */

const DEFAULT_FEEDS = [
  "https://feeds.npr.org/1014/rss.xml", // NPR Politics
]

const DEFAULT_GDELT_QUERIES = [
  '("campaign" OR "candidate" OR "ballot") sourcelang:english sourcecountry:US',
]

function list(name: string, fallback: string[], separator = ","): string[] {
  const raw = process.env[name]
  if (!raw) return fallback
  return raw
    .split(separator)
    .map((s) => s.trim())
    .filter(Boolean)
}

registry.register(
  rssAdapter({
    feeds: list("VOTR_RSS_FEEDS", DEFAULT_FEEDS),
    limitPerFeed: 10,
  }),
)

registry.register(
  gdeltAdapter({
    queries: list("VOTR_GDELT_QUERIES", DEFAULT_GDELT_QUERIES, "|"),
    limitPerQuery: 10,
    defaultTimespan: "3d",
  }),
)

registry.register(
  htmlAdapter({
    pages: list("VOTR_HTML_PAGES", []),
  }),
)

export { registry }
export type { SourceAdapter } from "./registry"
export { AdapterRegistry } from "./registry"
export type { AdapterRun, NormalizedDocument } from "./types"
