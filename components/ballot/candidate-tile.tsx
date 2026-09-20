import Image from "next/image"
import Link from "next/link"
import { ArrowUpRight, BadgeCheck } from "lucide-react"
import { initials } from "@/lib/format/name"
import type { BallotCandidate } from "@/lib/queries/ballot"

/**
 * One candidate on the ballot.
 *
 * Every tile is identical in weight. No party-coloured fills, no badges that
 * one candidate can earn and another cannot, and the only number on the card
 * is how many of their positions we have verified — which is a fact about our
 * coverage, not about them. The moment one tile looks better than the one next
 * to it, the page has made a recommendation.
 *
 * "Nothing on the record yet" is shown rather than hidden. It is the honest
 * state for most candidates in most races and pretending otherwise would mean
 * quietly dropping people from their own ballot.
 */
export function CandidateTile({ candidate }: { candidate: BallotCandidate }) {
  return (
    <Link
      href={`/candidate/${candidate.id}`}
      className="group flex h-full flex-col rounded-card border border-hairline bg-sheet p-4 transition-colors duration-150 hover:border-brand/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <div className="flex items-start gap-3.5">
        <Portrait candidate={candidate} />

        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-base leading-tight font-semibold tracking-[-0.02em] text-navy">
            {candidate.name}
          </h3>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-hairline bg-mist px-2 py-0.5 text-[11px] font-medium text-slate-ink">
              {candidate.party}
            </span>
            {candidate.incumbent ? (
              <span className="rounded-full border border-hairline bg-mist px-2 py-0.5 text-[11px] font-medium text-slate-ink">
                Incumbent
              </span>
            ) : null}
          </div>
        </div>

        <ArrowUpRight
          className="size-4 shrink-0 text-slate-ink/40 transition-colors group-hover:text-brand"
          aria-hidden="true"
        />
      </div>

      {candidate.ballotDesignation ? (
        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-ink">
          {candidate.ballotDesignation}
        </p>
      ) : null}

      <p className="mt-auto flex items-center gap-1.5 pt-3.5 font-mono text-[10px] tracking-[-0.01em] text-slate-ink/80">
        {candidate.positionCount > 0 ? (
          <>
            <BadgeCheck className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
            {candidate.positionCount === 1
              ? "1 verified position"
              : `${candidate.positionCount} verified positions`}
          </>
        ) : (
          "Nothing on the record yet"
        )}
      </p>
    </Link>
  )
}

/** Photo when we have one, initials when we do not. Same footprint either way. */
function Portrait({ candidate }: { candidate: BallotCandidate }) {
  if (candidate.photo) {
    return (
      <Image
        src={candidate.photo.imageUrl}
        alt={`Portrait of ${candidate.name}`}
        width={48}
        height={48}
        unoptimized
        className="size-12 shrink-0 rounded-2xl object-cover"
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className="grid size-12 shrink-0 place-items-center rounded-2xl bg-mist font-heading text-sm font-semibold text-navy/70 ring-1 ring-hairline ring-inset"
    >
      {initials(candidate.name)}
    </span>
  )
}
