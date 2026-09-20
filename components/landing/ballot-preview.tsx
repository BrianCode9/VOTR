import { MapPin } from "lucide-react"
import {
  ballotPreview,
  daysUntil,
  formatElectionDate,
} from "@/lib/landing/content"

/**
 * The hero's product mockup. It is a real, tabbable summary of the ballot
 * shape rather than a screenshot, so it stays sharp, responsive and readable
 * to a screen reader — and so the eventual live version can reuse the markup.
 */
export function BallotPreview() {
  const days = daysUntil(ballotPreview.date)

  return (
    <div className="relative">
      {/* Stacked sheets behind the card: depth without a drop-shadow pile-up. */}
      <div
        aria-hidden="true"
        className="absolute -top-3 right-3 left-3 h-full rounded-[1.75rem] border border-hairline bg-sheet/60"
      />
      <div
        aria-hidden="true"
        className="absolute -top-6 right-7 left-7 h-full rounded-[1.75rem] border border-hairline bg-sheet/35"
      />

      <div className="relative rounded-[1.75rem] border border-hairline bg-sheet p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[-0.01em] text-slate-ink/80">
              Your ballot
            </p>
            <p className="mt-2 font-heading text-lg leading-tight font-semibold text-navy">
              {ballotPreview.electionName}
            </p>
          </div>

          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-signal-tint px-2.5 py-1 font-mono text-[10px] tracking-wider text-signal-ink">
            <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
            {formatElectionDate(ballotPreview.date)}
          </span>
        </div>

        <div className="mt-5 space-y-1.5">
          {ballotPreview.races.map((race) => (
            <a
              key={race.id}
              href="#federal"
              className="group flex items-center gap-3 rounded-2xl border border-transparent px-3 py-3 transition-colors hover:border-hairline hover:bg-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <span className="flex-1 text-sm font-medium text-navy">
                {race.office}
              </span>
              <span className="text-sm text-slate-ink/80">
                {race.count} candidates
              </span>
            </a>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-2xl bg-mist px-3 py-3">
          <MapPin className="size-4 shrink-0 text-brand" aria-hidden="true" />
          <span className="truncate text-sm text-slate-ink">
            Set your address to load real races
          </span>
        </div>

        <p className="mt-4 font-mono text-[10px] tracking-wider text-slate-ink/80">
          {days} days out · sample ballot
        </p>
      </div>
    </div>
  )
}
