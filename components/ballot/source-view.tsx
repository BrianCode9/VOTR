"use client"

import { useId, useState } from "react"
import {
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  FileText,
  Loader2,
} from "lucide-react"
import { cn } from "cn"

/**
 * "See the original."
 *
 * Build order step 9. `/api/v1/insights/:id/source` has returned everything
 * this needs for a while; there was no UI. This is that UI.
 *
 * What it shows is the document as it was stored at ingest, not a re-fetch of
 * the URL. That distinction is the entire argument of the product: a publisher
 * who quietly edits a page cannot make a quote we verified stop matching,
 * because we are not reading their page, we are reading our copy of it and
 * highlighting the characters we checked.
 *
 * Fetched on expand rather than inlined. A stored document runs to several
 * kilobytes, and a topic page can carry fifty cards; shipping every document
 * with the page to serve the few a reader actually opens would be most of the
 * payload spent on nothing. `full=false` asks the endpoint for the excerpt
 * window alone and leaves the full text on the server.
 *
 * This is the one place in the app that talks to the HTTP API rather than
 * calling the query layer directly, because it is the one place the data is
 * needed after the server has finished rendering.
 */

interface SourcePayload {
  sourceUrl: string
  sourceName: string
  documentTitle: string
  publishedAt: string | null
  fetchedAt: string
  isSynthetic: boolean
  mediaType: "article" | "transcript"
  quoteVerified: "exact" | "normalized" | "transcript" | "fuzzy"
  quoteSimilarity: number | null
  span: { start: number; end: number }
  excerpt: {
    text: string
    start: number
    end: number
    highlightStart: number
    highlightEnd: number
  }
}

/**
 * What each rung of the verification ladder actually means.
 *
 * Spelled out rather than shown as a bare label, because "fuzzy" is the one
 * that matters and a reader has no way to guess that it means the stored quote
 * was corrected to match the document.
 */
const VERIFICATION_NOTES: Record<SourcePayload["quoteVerified"], string> = {
  exact: "Found character for character in the stored document.",
  normalized:
    "Matched after normalising whitespace and quotation marks. The words are unchanged.",
  transcript:
    "Matched against a transcript, where punctuation and casing are the transcriber's.",
  fuzzy:
    "The closest match in the document differed slightly from what was extracted, and the quote was corrected to what the document actually says.",
}

export function SourceView({ insightId }: { insightId: string }) {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<SourcePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)

    // Fetched once. The stored document is immutable by design, so there is
    // nothing to refresh.
    if (data || loading) return

    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/v1/insights/${insightId}/source?full=false`,
        { headers: { accept: "application/json" } },
      )
      if (!response.ok) throw new Error(`source unavailable (${response.status})`)
      setData((await response.json()) as SourcePayload)
    } catch {
      setError("We could not load the original just now.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-1.5 rounded-lg font-mono text-[10px] tracking-[-0.01em] text-brand transition-colors hover:text-brand-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <FileText className="size-3" aria-hidden="true" />
        {open ? "Hide the original" : "See it in the original"}
        <ChevronDown
          className={cn("size-3 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      <div id={panelId} hidden={!open} className="mt-3">
        {loading ? (
          <p className="flex items-center gap-2 font-mono text-[10px] text-slate-ink/80">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            Loading the stored document
          </p>
        ) : null}

        {error ? (
          <p className="font-mono text-[10px] text-signal-ink">{error}</p>
        ) : null}

        {data ? <SourcePanel data={data} /> : null}
      </div>
    </div>
  )
}

function SourcePanel({ data }: { data: SourcePayload }) {
  const { excerpt } = data
  const before = excerpt.text.slice(0, excerpt.highlightStart)
  const highlight = excerpt.text.slice(excerpt.highlightStart, excerpt.highlightEnd)
  const after = excerpt.text.slice(excerpt.highlightEnd)

  return (
    <div className="rounded-2xl border border-hairline bg-mist p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-heading text-sm font-semibold tracking-[-0.015em] text-navy">
          {data.documentTitle}
        </p>
        <span className="font-mono text-[10px] text-slate-ink/80">
          {data.sourceName}
        </span>
        {data.isSynthetic ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-signal bg-signal-tint px-2 py-0.5 font-mono text-[9px] text-signal-ink">
            <AlertTriangle className="size-2.5" aria-hidden="true" />
            Synthetic document
          </span>
        ) : null}
      </div>

      {/* The document, as stored. `whitespace-pre-wrap` because the stored text
          keeps the line breaks the extractor counted characters through, and
          collapsing them here would put the highlight somewhere else. */}
      <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-hairline bg-sheet p-3.5">
        <p className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-ink">
          {excerpt.start > 0 ? <span className="text-slate-ink/50">…</span> : null}
          {before}
          <mark className="bg-mark/70 px-0.5 font-medium text-navy">{highlight}</mark>
          {after}
          <span className="text-slate-ink/50">…</span>
        </p>
      </div>

      <dl className="mt-3 space-y-1.5 font-mono text-[10px] leading-relaxed text-slate-ink/80">
        <div className="flex gap-2">
          <dt className="shrink-0 text-slate-ink">Characters</dt>
          <dd>
            {data.span.start}&ndash;{data.span.end} of the stored document
          </dd>
        </div>

        <div className="flex gap-2">
          <dt className="shrink-0 text-slate-ink">Match</dt>
          <dd>
            {VERIFICATION_NOTES[data.quoteVerified]}
            {data.quoteVerified === "fuzzy" && data.quoteSimilarity !== null
              ? ` Similarity ${(data.quoteSimilarity * 100).toFixed(1)}%.`
              : null}
          </dd>
        </div>

        <div className="flex gap-2">
          <dt className="shrink-0 text-slate-ink">Stored</dt>
          <dd>
            {formatDay(data.fetchedAt)}
            {data.publishedAt ? ` · published ${formatDay(data.publishedAt)}` : null}
            {data.mediaType === "transcript" ? " · transcript" : null}
          </dd>
        </div>
      </dl>

      <a
        href={data.sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-3 inline-flex items-center gap-1.5 font-mono text-[10px] text-brand transition-colors hover:text-brand-deep"
      >
        <ExternalLink className="size-3" aria-hidden="true" />
        Open the page this was taken from
      </a>

      <p className="mt-2 font-mono text-[9px] leading-relaxed text-slate-ink/70">
        The text above is our copy, stored when we read the page. If the
        publisher has edited it since, the live page and this copy will differ —
        and the quote we checked is still the one we checked.
      </p>
    </div>
  )
}

/** Stable across server and client; no locale drift. */
function formatDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "unknown"
  return date.toISOString().slice(0, 10)
}
