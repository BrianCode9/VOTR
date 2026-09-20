import Link from "next/link"
import { Container } from "@/components/landing/section"
import { TopicIcon } from "@/components/landing/topic-icon"
import { readLocation, ballotPath } from "@/lib/location/cookie"
import { stateName } from "@/lib/location/states"
import { getBallot, getBallotTopics } from "@/lib/queries/ballot"
import { iconFor } from "@/lib/topics/icons"

/**
 * The reader's saved ballot, if they have one.
 *
 * Renders nothing at all when no location is saved: the hero form is already
 * the prompt, and a second panel asking the same thing is just another band to
 * scroll past.
 */
export async function ForMe() {
  const location = await readLocation()
  if (!location) return null

  const [ballot, topics] = await Promise.all([
    getBallot(location.state, location.district),
    getBallotTopics(location.state),
  ])
  if (!ballot) return null

  const candidates = ballot.races.reduce((n, r) => n + r.candidates.length, 0)

  return (
    <section id="for-me" className="pb-16 sm:pb-24">
      <Container>
        <div className="rounded-card border border-hairline bg-mist p-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-heading text-2xl font-semibold tracking-[-0.03em] text-navy">
              {stateName(location.state)}
              {ballot.districtMatched ? (
                <span className="text-slate-ink"> · district {ballot.district}</span>
              ) : null}
            </h2>
            <p className="font-mono text-[11px] text-slate-ink/80">
              {ballot.races.length} races · {candidates} candidates
            </p>
            <Link
              href={ballotPath(location)}
              className="ml-auto font-mono text-[11px] text-brand underline underline-offset-4 hover:text-brand-deep"
            >
              Open ballot
            </Link>
          </div>

          {topics.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {topics.slice(0, 8).map((topic) => (
                <Link
                  key={topic.slug}
                  href={`/ballot/${location.state}/topic/${topic.slug}`}
                  className="inline-flex items-center gap-2 rounded-full border border-hairline bg-sheet px-3 py-1.5 text-sm text-slate-ink transition-colors hover:border-brand/40 hover:text-navy"
                >
                  <TopicIcon name={iconFor(topic.slug)} className="size-3.5 text-brand" />
                  {topic.label}
                  <span className="font-mono text-[10px] text-slate-ink/70">
                    {topic.count}
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </Container>
    </section>
  )
}
