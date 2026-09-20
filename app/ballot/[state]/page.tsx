import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { CalendarDays, ChevronDown, Info, MapPin, Pencil } from "lucide-react"
import { CandidateTile } from "@/components/ballot/candidate-tile"
import { SiteNav } from "@/components/landing/site-nav"
import { SiteFooter } from "@/components/landing/site-footer"
import { Container } from "@/components/landing/section"
import { TopicIcon } from "@/components/landing/topic-icon"
import { iconFor } from "@/lib/topics/icons"
import { daysUntil, formatElectionDate } from "@/lib/landing/content"
import { stateByCode } from "@/lib/location/states"
import { getBallot, getBallotTopics, type BallotRace } from "@/lib/queries/ballot"

/**
 * The dashboard. The destination of the only question the landing page asks.
 *
 * Reads the database per request. The ballot is small for any one state and a
 * reader arriving from the form has just changed their district, so a cached
 * render would be showing them someone else's races.
 */
export const dynamic = "force-dynamic"

const LEVEL_LABELS: Record<string, string> = {
  federal: "Federal",
  state: "State",
  local: "Local",
}

/** Federal first, then state, then local: the order a paper ballot uses. */
const LEVEL_ORDER = ["federal", "state", "local"] as const

export async function generateMetadata({
  params,
}: PageProps<"/ballot/[state]">): Promise<Metadata> {
  const { state } = await params
  const info = stateByCode(state)
  if (!info) return { title: "Ballot" }

  return {
    title: `Who's running in ${info.name}`,
    description: `Every certified candidate on the ${info.name} ballot, with the positions we have verified against the source.`,
  }
}

export default async function BallotPage({
  params,
  searchParams,
}: PageProps<"/ballot/[state]">) {
  const { state } = await params
  const query = await searchParams

  const info = stateByCode(state)
  if (!info) notFound()

  // The district travels in the query string rather than the path so that
  // /ballot/CA is always a valid, shareable URL for the whole state.
  const districtParam = query.district
  const district =
    typeof districtParam === "string" && /^\d+$/.test(districtParam) ? districtParam : null

  const [ballot, topics] = await Promise.all([
    getBallot(info.code, district),
    getBallotTopics(info.code),
  ])

  if (!ballot) notFound()

  // Both helpers take a bare YYYY-MM-DD and build their own timestamp, so a
  // full ISO string parses to NaN. Sliced once, here.
  const electionDay = ballot.nextElection?.toISOString().slice(0, 10) ?? null
  const days = electionDay ? daysUntil(electionDay) : null
  const byLevel = LEVEL_ORDER.map((level) => ({
    level,
    races: ballot.races.filter((race) => race.level === level),
  })).filter((group) => group.races.length > 0)

  return (
    <div className="flex min-h-dvh flex-col bg-sheet">
      <SiteNav />

      <main id="main" className="flex-1">
        {/* ---------------------------------------------------------- head */}
        <section className="border-b border-hairline bg-mist py-10 sm:py-14">
          <Container>
            <p className="font-mono text-[11px] tracking-[-0.01em] text-brand">
              Your ballot
            </p>

            <div className="mt-3 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 className="font-heading text-3xl leading-[1.05] font-semibold tracking-[-0.035em] text-navy sm:text-4xl lg:text-[2.6rem]">
                  Who&rsquo;s running in {ballot.stateName}
                  {ballot.districtMatched ? (
                    <span className="text-slate-ink">
                      , district {ballot.district}
                    </span>
                  ) : null}
                </h1>

                <p className="mt-3 max-w-xl text-base leading-relaxed text-slate-ink sm:text-lg">
                  {ballot.districtMatched ? (
                    <>
                      These are the races you vote in: every statewide office,
                      plus your congressional district.
                    </>
                  ) : (
                    <>
                      These are the statewide races on every {ballot.stateName}{" "}
                      ballot. Add your street address to pull in your
                      congressional district too.
                    </>
                  )}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {electionDay ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-signal-tint px-3 py-1.5 font-mono text-[11px] tracking-[-0.01em] text-signal-ink">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    {formatElectionDate(electionDay, true)}
                    {days !== null && days > 0 ? ` · ${days} days` : null}
                  </span>
                ) : null}

                <Link
                  href="/"
                  className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-sheet px-3 py-1.5 font-mono text-[11px] tracking-[-0.01em] text-slate-ink transition-colors hover:border-brand/40 hover:text-navy"
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                  Change location
                </Link>
              </div>
            </div>

            {ballot.certification !== "certified" ? (
              <p className="mt-6 flex max-w-2xl items-start gap-2.5 rounded-card border border-signal/30 bg-signal-tint px-4 py-3 text-sm leading-relaxed text-signal-ink">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  {ballot.certification === "filings"
                    ? `No state authority has certified a ${ballot.stateName} ballot to us yet. Everyone below has filed a federal campaign-finance declaration to run. That is a statement of intent, not a confirmed place on the ballot, and some of them will not appear on it.`
                    : `Some candidates below were certified by a state election authority and some are federal campaign-finance filings, which are declarations of intent rather than a confirmed place on the ballot. Each card says which.`}
                </span>
              </p>
            ) : null}

            <dl className="mt-8 grid grid-cols-2 gap-3 sm:max-w-2xl sm:grid-cols-3">
              <Stat
                label={ballot.districtMatched ? "Races you vote in" : "Statewide races"}
                value={ballot.races.length}
              />
              <Stat
                label="Candidates on your ballot"
                value={ballot.races.reduce((n, r) => n + r.candidates.length, 0)}
              />
              <Stat label="Verified positions in state" value={ballot.totals.positions} />
            </dl>
          </Container>
        </section>

        {/* -------------------------------------------------------- topics */}
        {topics.length > 0 ? (
          <section className="border-b border-hairline py-6">
            <Container>
              <p className="font-mono text-[10px] tracking-[-0.01em] text-slate-ink/80">
                What they&rsquo;re on record about in {ballot.stateName}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {topics.map((topic) => (
                  <Link
                    key={topic.slug}
                    href={`/ballot/${ballot.state}/topic/${topic.slug}`}
                    className="inline-flex items-center gap-2 rounded-full border border-hairline bg-mist px-3.5 py-1.5 text-sm font-medium text-slate-ink transition-colors hover:border-brand/40 hover:text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    <TopicIcon name={iconFor(topic.slug)} className="size-3.5 text-brand" />
                    {topic.label}
                    <span className="font-mono text-[10px] text-slate-ink/70">
                      {topic.count}
                    </span>
                  </Link>
                ))}
              </div>
            </Container>
          </section>
        ) : null}

        {/* --------------------------------------------------------- races */}
        <Container className="py-12 sm:py-16">
          <div className="space-y-14">
            {byLevel.map(({ level, races }) => (
              <section key={level}>
                <div className="flex items-baseline gap-3 border-b border-hairline pb-3">
                  <h2 className="font-heading text-xl font-semibold tracking-[-0.025em] text-navy">
                    {LEVEL_LABELS[level]}
                  </h2>
                  <span className="font-mono text-[11px] text-slate-ink/80">
                    {races.length === 1 ? "1 race" : `${races.length} races`}
                  </span>
                </div>

                <div className="mt-8 space-y-10">
                  {races.map((race) => (
                    <RaceBlock key={race.id} race={race} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {ballot.otherRaces.length > 0 ? (
            <OtherRaces races={ballot.otherRaces} stateName={ballot.stateName} />
          ) : null}
        </Container>
      </main>

      <SiteFooter />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-hairline bg-sheet px-4 py-3">
      <dt className="font-mono text-[10px] tracking-[-0.01em] text-slate-ink/80">
        {label}
      </dt>
      <dd className="mt-1 font-heading text-2xl font-semibold tracking-[-0.03em] text-navy">
        {value}
      </dd>
    </div>
  )
}

function RaceBlock({ race }: { race: BallotRace }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-heading text-lg font-semibold tracking-[-0.02em] text-navy">
          {race.office}
        </h3>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-ink/80">
          <MapPin className="size-3" aria-hidden="true" />
          {race.districtName}
        </span>
        <span className="font-mono text-[11px] text-slate-ink/80">
          {race.candidates.length === 1
            ? "1 candidate"
            : `${race.candidates.length} candidates`}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {race.candidates.map((candidate) => (
          <CandidateTile key={candidate.id} candidate={candidate} />
        ))}
      </div>
    </div>
  )
}

/**
 * Every other race in the state.
 *
 * A native `<details>` so the section costs no JavaScript and is open to
 * find-in-page. These are real elections with real candidates, so they are not
 * dropped, but they are held behind a disclosure and labelled as someone
 * else's, because listing them as "your ballot" would be false.
 */
function OtherRaces({ races, stateName }: { races: BallotRace[]; stateName: string }) {
  const byOffice = new Map<string, BallotRace[]>()
  for (const race of races) {
    byOffice.set(race.office, [...(byOffice.get(race.office) ?? []), race])
  }

  const candidates = races.reduce((n, race) => n + race.candidates.length, 0)

  return (
    <details className="group mt-14 rounded-card border border-hairline bg-mist">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        <div>
          <p className="font-heading text-base font-semibold tracking-[-0.02em] text-navy">
            Elsewhere in {stateName}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-ink/80">
            {races.length} more races · {candidates} candidates · not on your ballot
          </p>
        </div>
        <ChevronDown
          className="size-4 shrink-0 text-slate-ink/70 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>

      <div className="space-y-7 border-t border-hairline px-5 py-6">
        {[...byOffice.entries()].map(([office, group]) => (
          <div key={office}>
            <h3 className="font-mono text-[11px] tracking-[-0.01em] text-slate-ink">
              {office}
            </h3>
            <ul className="mt-2 divide-y divide-hairline">
              {group.map((race) => (
                <li key={race.id} className="flex flex-wrap items-baseline gap-x-2 py-2">
                  <span className="text-sm font-medium text-navy">
                    {race.districtName}
                  </span>
                  <span className="text-sm text-slate-ink">
                    {race.candidates.map((candidate, index) => (
                      <span key={candidate.id}>
                        {index > 0 ? ", " : ""}
                        <Link
                          href={`/candidate/${candidate.id}`}
                          className="underline decoration-hairline underline-offset-2 transition-colors hover:text-brand hover:decoration-brand"
                        >
                          {candidate.name}
                        </Link>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  )
}
