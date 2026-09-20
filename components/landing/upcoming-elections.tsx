import { Container } from "@/components/landing/section"
import {
  daysUntil,
  formatElectionDate,
  type ElectionLevel,
} from "@/lib/landing/content"
import { getElections } from "@/lib/landing/queries"

const LEVEL_LABELS: Record<ElectionLevel, string> = {
  federal: "Federal",
  state: "State",
  local: "Local",
}

/** Next election date and countdown. */
export async function UpcomingElections() {
  const [next] = await getElections()
  if (!next) return null

  return (
    <section id="ballot" className="pb-8 sm:pb-10">
      <Container>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 rounded-card border border-hairline bg-mist px-5 py-4">
          <p className="font-heading text-2xl font-semibold tracking-[-0.03em] text-navy">
            {formatElectionDate(next.date, true)}
          </p>
          <p className="text-slate-ink">{next.name}</p>
          <p className="font-mono text-[11px] text-signal-ink">
            {daysUntil(next.date)} days
          </p>
          <p className="ml-auto font-mono text-[10px] text-slate-ink/70">
            {next.levels.map((level) => LEVEL_LABELS[level]).join(" · ")}
          </p>
        </div>
      </Container>
    </section>
  )
}
