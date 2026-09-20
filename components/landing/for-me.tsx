import Link from "next/link"
import { ArrowRight, Check, MapPin } from "lucide-react"
import { Container, Eyebrow } from "@/components/landing/section"
import { TopicIcon } from "@/components/landing/topic-icon"
import { readLocation, ballotPath } from "@/lib/location/cookie"
import { stateName } from "@/lib/location/states"
import { getBallot, getBallotTopics } from "@/lib/queries/ballot"
import { iconFor } from "@/lib/topics/icons"

/**
 * "For Me".
 *
 * This was a client component holding a second copy of the address field and a
 * set of issue toggles whose submit handler called `setSaved(true)` and did
 * nothing else — a personalisation panel that personalised nothing and led
 * nowhere.
 *
 * It is now a read of the real thing. A reader who has told us where they vote
 * sees their actual ballot summarised here, with the issues their actual
 * candidates are on record about, each one a link. A reader who has not sees
 * what they would get and a way up to the form. No local state, no fake save.
 *
 * Note what it personalises: which races and issues are yours, never which
 * candidate is shown first. Ordering people by predicted agreement is the one
 * thing this product refuses to do.
 */
export async function ForMe() {
  const location = await readLocation()

  const [ballot, topics] = location
    ? await Promise.all([
        getBallot(location.state, location.district),
        getBallotTopics(location.state),
      ])
    : [null, []]

  return (
    <section id="for-me" className="relative overflow-hidden bg-navy py-20 text-white sm:py-28">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/4 size-[30rem] rounded-full bg-brand/25 blur-[130px]" />
        <div className="absolute -right-24 -bottom-32 size-[26rem] rounded-full bg-brand-bright/12 blur-[120px]" />
      </div>

      <Container className="relative">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div>
            <Eyebrow tone="inverse">For me</Eyebrow>

            <h2 className="mt-3 font-heading text-3xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-4xl lg:text-[2.6rem]">
              Your political information, simplified.
            </h2>

            <p className="mt-4 max-w-md text-base leading-relaxed text-pretty text-white/70 sm:text-lg">
              Tell Votr where you vote and it puts those races and issues first
              — and leaves the conclusions to you.
            </p>

            <ul className="mt-8 space-y-3 text-sm text-white/65">
              {[
                "Orders your races, never the candidates",
                "Change or clear it whenever you want",
                "Works without an account",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-brand-bright"
                    aria-hidden="true"
                  />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[1.75rem] border border-navy-line bg-navy-raised/80 p-6 backdrop-blur-sm sm:p-8">
            {ballot && location ? (
              <Saved
                href={ballotPath(location)}
                stateLabel={stateName(location.state)}
                district={ballot.districtMatched ? ballot.district : null}
                races={ballot.races.length}
                candidates={ballot.races.reduce((n, r) => n + r.candidates.length, 0)}
                state={location.state}
                topics={topics}
              />
            ) : (
              <Unset />
            )}
          </div>
        </div>
      </Container>
    </section>
  )
}

function Saved({
  href,
  stateLabel,
  district,
  races,
  candidates,
  state,
  topics,
}: {
  href: string
  stateLabel: string
  district: string | null
  races: number
  candidates: number
  state: string
  topics: { slug: string; label: string; count: number }[]
}) {
  return (
    <>
      <p className="font-mono text-[10px] tracking-[-0.01em] text-white/55">
        Saved on this device
      </p>

      <p className="mt-3 flex items-center gap-2 font-heading text-2xl font-semibold tracking-[-0.03em]">
        <MapPin className="size-5 shrink-0 text-brand-bright" aria-hidden="true" />
        {stateLabel}
        {district ? (
          <span className="text-white/60">· district {district}</span>
        ) : null}
      </p>

      <p className="mt-2 text-sm text-white/65">
        {races} {races === 1 ? "race" : "races"} on your ballot ·{" "}
        {candidates} {candidates === 1 ? "candidate" : "candidates"}
      </p>

      {topics.length > 0 ? (
        <>
          <p className="mt-7 font-mono text-[10px] tracking-[-0.01em] text-white/55">
            What your candidates are on record about
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {topics.slice(0, 8).map((topic) => (
              <Link
                key={topic.slug}
                href={`/ballot/${state}/topic/${topic.slug}`}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-sheet/[0.03] px-3.5 py-2 text-sm font-medium text-white/75 transition-colors hover:border-brand-bright hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright"
              >
                <TopicIcon name={iconFor(topic.slug)} className="size-3.5" />
                {topic.label}
                <span className="font-mono text-[10px] text-white/50">
                  {topic.count}
                </span>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-7 text-sm leading-relaxed text-white/60">
          We have not verified any quotes from candidates in {stateLabel} yet.
          Their races and certified filings are all on your ballot; the
          positions follow as the scan reaches them.
        </p>
      )}

      <Link
        href={href}
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-sheet px-6 py-3 text-base font-medium text-navy transition-colors hover:bg-brand-bright hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright"
      >
        Open my ballot
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </>
  )
}

function Unset() {
  return (
    <>
      <p className="font-mono text-[10px] tracking-[-0.01em] text-white/55">
        Nothing saved yet
      </p>

      <p className="mt-3 font-heading text-2xl leading-tight font-semibold tracking-[-0.03em]">
        Pick your state and this becomes your ballot.
      </p>

      <ul className="mt-6 space-y-3 text-sm text-white/65">
        {[
          "Every certified candidate in your races",
          "What each of them has said, quoted from the source",
          "Your congressional district, if you add your address",
        ].map((line) => (
          <li key={line} className="flex items-start gap-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-brand-bright" aria-hidden="true" />
            {line}
          </li>
        ))}
      </ul>

      <Link
        href="/#start"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-sheet px-6 py-3 text-base font-medium text-navy transition-colors hover:bg-brand-bright hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright"
      >
        Choose your state
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </>
  )
}
