import Link from "next/link"
import { AlertTriangle, ExternalLink, Quote } from "lucide-react"
import { cn } from "cn"
import type { FeedItem } from "@/lib/queries/feed"
import { iconFor } from "@/lib/topics/icons"
import { TopicIcon } from "@/components/landing/topic-icon"
import { SourceView } from "@/components/ballot/source-view"

/**
 * One verified position, at document scale rather than feed scale.
 *
 * `InsightCard` is one card per viewport with a snap-scroll gesture, which is
 * right for a feed and wrong for a profile where the point is to read several
 * positions together. This renders the same FeedItem in a list.
 *
 * Three things it carries over from InsightCard, because they are correctness
 * rather than styling:
 *
 * - The synthetic badge is decided here, at the component, so no caller can
 *   forget to pass it. An unlabelled synthetic document is the worst bug this
 *   app can ship.
 * - `presentationMode` is obeyed, not re-derived. `nudge_verify` leads with
 *   the quote and never states the claim as flat fact.
 * - The quote is whatever the server sliced out of the stored document at the
 *   verified offsets. It is never reassembled here.
 */

const FLAG_LABELS: Record<string, string> = {
  NEW: "New position",
  FLIP_FLOP: "Changed position",
  UNVERIFIED_CLAIM: "Unverified claim",
}

export function PositionCard({
  item,
  showCandidate = false,
}: {
  item: FeedItem
  /** On a topic page the reader needs to know who said it. On a profile they do not. */
  showCandidate?: boolean
}) {
  const nudge = item.presentationMode === "nudge_verify"
  const claim = item.plainLanguageSummary ?? item.plainLanguage ?? item.headline

  return (
    <article className="rounded-card border border-hairline bg-sheet p-5">
      <header className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-mist px-2.5 py-0.5 font-mono text-[10px] tracking-[-0.01em] text-slate-ink">
          <TopicIcon name={iconFor(item.issueTag)} className="size-3 text-brand" />
          {item.issueTag.replace(/_/g, " ")}
        </span>

        {item.flags.map((flag) => (
          <span
            key={flag}
            className="rounded-full border border-signal/40 bg-signal-tint px-2.5 py-0.5 font-mono text-[10px] tracking-[-0.01em] text-signal-ink"
          >
            {FLAG_LABELS[flag] ?? flag}
          </span>
        ))}

        {item.isSynthetic ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-signal bg-signal-tint px-2.5 py-0.5 font-mono text-[10px] tracking-[-0.01em] text-signal-ink">
            <AlertTriangle className="size-3" aria-hidden="true" />
            Synthetic document
          </span>
        ) : null}

        {showCandidate && item.candidateName ? (
          <span className="ml-auto font-mono text-[10px] tracking-[-0.01em] text-slate-ink/80">
            {item.candidateName}
          </span>
        ) : null}
      </header>

      {/* The quote leads when confidence is low. Otherwise the plain-language
          reading leads and the quote backs it up. */}
      {nudge ? (
        <>
          <QuoteBlock item={item} />
          <p className="mt-3 text-sm leading-relaxed text-slate-ink">
            <span className="font-medium text-navy">What this may mean: </span>
            {claim}
          </p>
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-signal-ink">
            Our reading of this quote is low confidence. Check the source before
            relying on it.
          </p>
        </>
      ) : (
        <>
          <p className="mt-3 font-heading text-base leading-snug font-semibold tracking-[-0.015em] text-navy">
            {claim}
          </p>
          <QuoteBlock item={item} />
        </>
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline pt-3.5 font-mono text-[10px] tracking-[-0.01em] text-slate-ink/80">
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-brand"
        >
          <ExternalLink className="size-3" aria-hidden="true" />
          {item.sourceName}
        </a>

        <span>
          {item.sourceDiversity.count === 1
            ? "1 source"
            : `${item.sourceDiversity.count} independent sources`}
        </span>
      </footer>

      {/* The character span used to be printed here as a bare number, which
          told a reader we had checked something without letting them check it.
          It now opens the stored document at that span. */}
      <SourceView insightId={item.id} />
    </article>
  )
}

function QuoteBlock({ item }: { item: FeedItem }) {
  return (
    <blockquote
      className={cn(
        "relative mt-3 rounded-2xl border-l-2 border-brand bg-mist py-3 pr-4 pl-9 text-sm leading-relaxed text-navy",
      )}
    >
      <Quote
        className="absolute top-3.5 left-3 size-3.5 text-brand/60"
        aria-hidden="true"
      />
      &ldquo;{item.quote}&rdquo;
    </blockquote>
  )
}

/** The shared empty state. Says what is missing rather than implying nothing exists. */
export function NoPositions({
  name,
  state,
}: {
  name: string
  state?: string | null
}) {
  return (
    <div className="rounded-card border border-dashed border-hairline bg-mist px-5 py-8 text-center">
      <p className="font-heading text-base font-semibold tracking-[-0.02em] text-navy">
        Nothing on the record yet
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-ink">
        We have not verified any quotes from {name}. That means our scan has not
        reached them — not that they have said nothing. Every position here is
        checked character for character against its source before it appears,
        which is slower than repeating what a campaign says about itself.
      </p>
      {state ? (
        <Link
          href={`/ballot/${state}`}
          className="mt-4 inline-block font-mono text-[11px] text-brand underline underline-offset-4 hover:text-brand-deep"
        >
          Back to the ballot
        </Link>
      ) : null}
    </div>
  )
}
