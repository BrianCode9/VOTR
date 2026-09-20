import Image from "next/image"
import Link from "next/link"

import type { Candidate } from "@/lib/landing/content"

/**
 * One candidate.
 *
 * Every card is identical in weight, and they are never ordered by anything
 * but office then surname. No scores, no badges, no party-coloured fills. The
 * moment a card looks better than its neighbour, the page has made a
 * recommendation Votr has no business making.
 */
export function CandidateCard({ candidate }: { candidate: Candidate }) {
  return (
    <Link
      href={`/candidate/${candidate.id}`}
      className="group flex h-full flex-col rounded-card border border-hairline bg-sheet p-5 transition-colors duration-150 hover:border-brand/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <div className="flex items-center gap-4">
        <CandidatePortrait candidate={candidate} />

        <div className="min-w-0">
          <p className="truncate font-mono text-[10px] tracking-[-0.01em] text-slate-ink/80">
            {candidate.office}
          </p>
          <h3 className="mt-1 truncate font-heading text-lg font-semibold tracking-[-0.02em] text-navy">
            {candidate.name}
          </h3>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-hairline bg-mist px-2.5 py-0.5 text-[11px] font-medium text-slate-ink">
          {candidate.party}
        </span>
        <span className="rounded-full border border-hairline bg-mist px-2.5 py-0.5 text-[11px] font-medium text-slate-ink">
          {candidate.jurisdiction}
        </span>
      </div>

      <p className="mt-4 flex-1 text-sm leading-relaxed text-slate-ink">
        {candidate.bio}
      </p>

      <span className="mt-5 inline-flex items-center gap-1.5 border-t border-hairline pt-4 text-sm font-medium text-brand">
        View profile
      </span>
    </Link>
  )
}

/** Photo when we have one, initials when we do not. Same footprint either way. */
function CandidatePortrait({ candidate }: { candidate: Candidate }) {
  if (candidate.photoUrl) {
    return (
      <Image
        src={candidate.photoUrl}
        alt={`Portrait of ${candidate.name}`}
        width={56}
        height={56}
        unoptimized
        className="size-14 shrink-0 rounded-2xl object-cover"
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className="grid size-14 shrink-0 place-items-center rounded-sm bg-mist font-heading text-base font-semibold text-navy/70 ring-1 ring-hairline ring-inset"
    >
      {initials(candidate.name)}
    </span>
  )
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}
