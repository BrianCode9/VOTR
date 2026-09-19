"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import type { FeedItem } from "@/lib/queries/feed"

/**
 * One insight, one viewport.
 *
 * The synthetic badge is rendered here, at the component level, deliberately.
 * The spec calls an unlabeled synthetic document the worst possible bug in this
 * app, so the badge cannot be something a caller forgets to pass: if
 * item.isSynthetic is true, this component shows it. Do not move this decision
 * up to the data layer.
 */

const ISSUE_LABELS: Record<string, string> = {
  jobs_and_labor: "jobs and labor",
  transit_and_infrastructure: "transit and infrastructure",
  taxes_and_budget: "taxes and budget",
  technology_and_privacy: "technology and privacy",
  reproductive_rights: "reproductive rights",
  criminal_justice: "criminal justice",
  public_safety: "public safety",
  voting_rights: "voting rights",
  foreign_policy: "foreign policy",
}

const FLAG_LABELS: Record<string, string> = {
  NEW: "New",
  FLIP_FLOP: "Flip flop",
  UNVERIFIED_CLAIM: "Unverified claim",
}

export function InsightCard({ item }: { item: FeedItem }) {
  const ref = useRef<HTMLElement>(null)
  const [swept, setSwept] = useState(false)
  const [showWhy, setShowWhy] = useState(false)

  // The highlight sweep is the one orchestrated entrance. It fires when the
  // card actually reaches the viewport, not on mount, or every card sweeps at
  // once behind the fold and the gesture is wasted.
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setSwept(true)
      },
      { threshold: 0.55 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const issue = ISSUE_LABELS[item.issueTag] ?? item.issueTag.replace(/_/g, " ")

  return (
    <article
      ref={ref}
      className="snap-start h-dvh w-full shrink-0 flex flex-col justify-between bg-ink px-6 py-8 sm:px-10"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-lo">
          {issue}
        </span>

        {item.flag ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-stamp border border-stamp px-1.5 py-0.5">
            {FLAG_LABELS[item.flag] ?? item.flag}
          </span>
        ) : null}

        {/* Never conditional on anything but the document itself. */}
        {item.isSynthetic ? (
          <span className="font-mono text-[10px] uppercase tracking-wider bg-stamp text-text-hi px-1.5 py-0.5">
            Synthetic document
          </span>
        ) : null}
      </header>

      <div className="flex-1 flex flex-col justify-center py-6 min-h-0 overflow-y-auto">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt=""
            width={1280}
            height={720}
            unoptimized
            className="mb-6 aspect-[16/9] w-full max-h-[28vh] object-cover"
          />
        ) : null}

        <blockquote>
          <p className="text-[clamp(1.5rem,5.2vw,2.75rem)] leading-[1.15] font-semibold tracking-[-0.02em]">
            <span
              data-swept={swept}
              className="box-decoration-clone px-1 text-ink bg-mark bg-no-repeat [background-image:linear-gradient(var(--color-mark),var(--color-mark))] [background-size:0%_100%] data-[swept=true]:[background-size:100%_100%] [transition:background-size_700ms_cubic-bezier(0.22,1,0.36,1)] motion-reduce:[background-size:100%_100%] motion-reduce:transition-none"
            >
              {item.quote}
            </span>
          </p>
        </blockquote>

        <p className="mt-6 text-base sm:text-lg text-text-hi/80 max-w-prose">
          {item.plainLanguage}
        </p>
      </div>

      <footer className="space-y-3">
        <div className="font-mono text-[11px] leading-relaxed text-text-lo">
          <div className="text-text-hi">{item.candidateName}</div>
          <div>
            {item.attribution === "own_words" ? "Own words" : "Reporter's characterization"}
            {" · "}
            {item.sourceName}
            {item.publishedAt
              ? ` · ${item.publishedAt.toISOString().slice(0, 10)}`
              : ""}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] uppercase tracking-wider bg-paper text-ink px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
          >
            See original
          </a>
          <button
            type="button"
            onClick={() => setShowWhy((v) => !v)}
            aria-expanded={showWhy}
            className="font-mono text-[11px] uppercase tracking-wider border border-text-lo/40 text-text-lo px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
          >
            Why am I seeing this
          </button>
        </div>

        {showWhy ? (
          <p className="font-mono text-[11px] leading-relaxed text-text-lo max-w-prose">
            This quote was matched character for character against the stored copy of{" "}
            <span className="text-text-hi">{item.documentTitle}</span>, at characters{" "}
            {item.span.start} to {item.span.end}. The text above is rendered by slicing
            that document, not by repeating what a model wrote.
            {item.judgeRating === null
              ? " It has not been rated by the verification judge yet."
              : ` The verification judge rated it ${item.judgeRating} out of 3.`}
          </p>
        ) : null}
      </footer>
    </article>
  )
}
