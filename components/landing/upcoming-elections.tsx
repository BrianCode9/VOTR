import { CalendarDays } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Container } from "@/components/landing/section"
import { Reveal } from "@/components/landing/reveal"
import {
  daysUntil,
  formatElectionDate,
  type ElectionLevel,
} from "@/lib/landing/content"
import { StartLink } from "@/components/ballot/start-link"
import { getElections } from "@/lib/landing/queries"

const LEVEL_LABELS: Record<ElectionLevel, string> = {
  federal: "Federal",
  state: "State",
  local: "Local",
}

/**
 * The countdown band. One navy slab directly under the hero: it breaks the
 * white, and it puts the only genuinely time-sensitive thing on the page
 * above everything else.
 */
export async function UpcomingElections() {
  const [next, ...rest] = await getElections()

  if (!next) return null

  return (
    <section id="ballot" className="pb-20 sm:pb-28">
      <Container>
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] bg-navy p-6 text-white sm:p-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
            >
              <div className="absolute -top-24 -right-16 size-[26rem] rounded-full bg-brand/30 blur-[110px]" />
              <div className="absolute -bottom-28 -left-10 size-[20rem] rounded-full bg-brand-bright/15 blur-[110px]" />
            </div>

            <div className="relative grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
              <div>
                <p className="flex items-center gap-2 font-mono text-[10px] tracking-[-0.01em] text-brand-bright sm:text-[11px]">
                  <CalendarDays className="size-3.5" aria-hidden="true" />
                  Upcoming elections
                </p>

                <div className="mt-5 flex flex-wrap items-baseline gap-x-5 gap-y-2">
                  <p className="font-heading text-[clamp(2.75rem,9vw,4.5rem)] leading-none font-semibold tracking-[-0.04em]">
                    {formatElectionDate(next.date)}
                  </p>
                  <p className="font-heading text-xl font-medium text-white/85 sm:text-2xl">
                    {next.name}
                  </p>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-signal/15 px-3 py-1 font-mono text-[11px] tracking-wider text-[#FF8A93]">
                    <span
                      className="size-1.5 rounded-full bg-signal"
                      aria-hidden="true"
                    />
                    {daysUntil(next.date)} days away
                  </span>

                  {next.levels.map((level) => (
                    <span
                      key={level}
                      className="rounded-full border border-white/15 px-3 py-1 font-mono text-[11px] tracking-wider text-white/70"
                    >
                      {LEVEL_LABELS[level]}
                    </span>
                  ))}
                </div>

                <p className="mt-5 max-w-md text-white/70">
                  {next.note}. Enter your address once and Votr keeps every race,
                  deadline and candidate in one place.
                </p>

                <Button
                  asChild
                  size="lg"
                  className="mt-7 h-12 rounded-full bg-sheet px-6 text-base text-navy hover:bg-brand-bright hover:text-white"
                >
                  <StartLink>View your ballot</StartLink>
                </Button>
              </div>

              <div>
                <p className="font-mono text-[10px] tracking-[-0.01em] text-white/55">
                  Also on the calendar
                </p>

                <ul className="mt-4 divide-y divide-white/10 border-t border-white/10">
                  {rest.map((election) => (
                    <li key={election.id}>
                      <StartLink className="group flex items-center gap-4 py-4 transition-colors hover:text-brand-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright">
                        <span className="w-20 shrink-0 font-mono text-xs tracking-wider text-white/55">
                          {formatElectionDate(election.date, true)}
                        </span>
                        <span className="flex-1">
                          <span className="block font-medium">
                            {election.name}
                          </span>
                          <span className="block text-sm text-white/55">
                            {election.levels
                              .map((level) => LEVEL_LABELS[level])
                              .join(" · ")}
                          </span>
                        </span>
                      </StartLink>
                    </li>
                  ))}
                </ul>

                <p className="mt-6 font-mono text-[11px] leading-relaxed text-white/55">
                  Dates shown are samples until you set a location. Votr supports
                  federal, state and local calendars.
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
