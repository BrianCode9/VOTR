import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, BadgeCheck, CalendarDays, ExternalLink, MapPin } from "lucide-react"
import { NoPositions, PositionCard } from "@/components/ballot/position-card"
import { Container } from "@/components/landing/section"
import { SiteNav } from "@/components/landing/site-nav"
import { SiteFooter } from "@/components/landing/site-footer"
import { initials } from "@/lib/format/name"
import { formatElectionDate } from "@/lib/landing/content"
import { getCandidate } from "@/lib/queries/ballot"
import { getInsightFeed } from "@/lib/queries/feed"

/** Reads per request; a profile is cheap and its positions change as we scan. */
export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/candidate/[id]">): Promise<Metadata> {
  const { id } = await params
  const candidate = await getCandidate(id)
  if (!candidate) return { title: "Candidate not found" }

  return {
    title: `${candidate.name}, ${candidate.office}`,
    description: `What ${candidate.name} has said, quoted from the source and verified character for character.`,
  }
}

export default async function CandidatePage({ params }: PageProps<"/candidate/[id]">) {
  const { id } = await params
  const candidate = await getCandidate(id)
  if (!candidate) notFound()

  /**
   * Positions are fetched by speaker when we have one and by candidate
   * otherwise. The speaker is the person and the candidate is one ballot line,
   * so a profile keyed only on the candidate row shows part of someone's
   * record and presents it as all of it. See the note on `speakers` in
   * db/schema.ts.
   */
  const { items } = await getInsightFeed(
    candidate.speakerId
      ? { speakerId: candidate.speakerId, limit: 50 }
      : { candidateId: candidate.id, limit: 50 },
  )
  const positions = items.filter((item) => item.quote.trim().length > 0)

  const electionDay = candidate.electionDate?.toISOString().slice(0, 10) ?? null

  return (
    <div className="flex min-h-dvh flex-col bg-sheet">
      <SiteNav />

      <main id="main" className="flex-1">
        <section className="border-b border-hairline bg-mist py-10 sm:py-12">
          <Container>
            <Link
              href={`/ballot/${candidate.state}`}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[-0.01em] text-slate-ink transition-colors hover:text-brand"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              {candidate.stateName} ballot
            </Link>

            <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
              <Portrait candidate={candidate} />

              <div className="min-w-0 flex-1">
                <h1 className="font-heading text-3xl leading-[1.05] font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
                  {candidate.name}
                </h1>

                <p className="mt-2 text-base text-slate-ink sm:text-lg">
                  Candidate for {candidate.office}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Chip>{candidate.party}</Chip>
                  {candidate.incumbent ? <Chip>Incumbent</Chip> : null}
                  <Chip>
                    <MapPin className="size-3" aria-hidden="true" />
                    {candidate.districtName}
                  </Chip>
                  {electionDay ? (
                    <Chip>
                      <CalendarDays className="size-3" aria-hidden="true" />
                      {formatElectionDate(electionDay, true)}
                    </Chip>
                  ) : null}
                </div>

                {!candidate.certified ? (
                  <p className="mt-4 max-w-xl rounded-card border border-signal/30 bg-signal-tint px-4 py-2.5 text-sm leading-relaxed text-signal-ink">
                    This is a federal campaign-finance filing, not a certified
                    ballot listing. They have declared a run; no state authority
                    has confirmed to us that they will appear on the ballot.
                  </p>
                ) : null}

                {candidate.background ? (
                  <div className="mt-4 max-w-xl text-sm leading-relaxed text-slate-ink">
                    <p><span className="font-medium text-navy">Background: </span>{candidate.background.text}</p>
                    <a href={candidate.background.sourceUrl} target="_blank" rel="noreferrer noopener"
                      className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-brand hover:underline">
                      {candidate.background.sourceKind === "official_office" ? "Source: official office biography" : "Source: campaign biography"}
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  </div>
                ) : null}

                {candidate.ballotDesignation ? (
                  <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-ink">
                    <span className="font-medium text-navy">
                      Ballot designation:{" "}
                    </span>
                    {candidate.ballotDesignation}
                    <span className="block font-mono text-[10px] text-slate-ink/70">
                      This is the description that appears next to their name on
                      the paper ballot, in their own words. Not a summary we
                      wrote.
                    </span>
                  </p>
                ) : null}

                <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] tracking-[-0.01em] text-slate-ink/80">
                  {candidate.source ? (
                    <a
                      href={candidate.source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 transition-colors hover:text-brand"
                    >
                      <BadgeCheck className="size-3.5 text-brand" aria-hidden="true" />
                      {candidate.certified
                        ? `Certified by ${candidate.source.name}`
                        : `Declared with the ${candidate.source.name}`}
                    </a>
                  ) : null}

                  {candidate.campaignWebsite ? (
                    <a
                      href={candidate.campaignWebsite}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 transition-colors hover:text-brand"
                    >
                      <ExternalLink className="size-3" aria-hidden="true" />
                      Campaign website
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          </Container>
        </section>

        <Container className="py-10 sm:py-14">
          <div className="flex items-baseline gap-3 border-b border-hairline pb-3">
            <h2 className="font-heading text-xl font-semibold tracking-[-0.025em] text-navy">
              On the record
            </h2>
            <span className="font-mono text-[11px] text-slate-ink/80">
              {positions.length === 0
                ? "no verified positions yet"
                : positions.length === 1
                  ? "1 verified position"
                  : `${positions.length} verified positions`}
            </span>
          </div>

          <div className="mt-6 max-w-3xl space-y-4">
            {positions.length === 0 ? (
              <NoPositions name={candidate.name} state={candidate.state} />
            ) : (
              positions.map((item) => <PositionCard key={item.id} item={item} />)
            )}
          </div>

          <p className="mt-8 max-w-3xl font-mono text-[10px] leading-relaxed text-slate-ink/70">
            Every quote on this page was located in its source document by
            character offset and re-checked against that document before it was
            stored. Votr describes; it does not rank, score, or endorse.
          </p>
        </Container>
      </main>

      <SiteFooter />
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-sheet px-3 py-1 text-[12px] font-medium text-slate-ink">
      {children}
    </span>
  )
}

/**
 * Portrait with its attribution.
 *
 * The credit line is not optional decoration: these are reusable-licensed
 * images and the licence requires the creator and the licence name to travel
 * with the image.
 */
function Portrait({
  candidate,
}: {
  candidate: NonNullable<Awaited<ReturnType<typeof getCandidate>>>
}) {
  if (!candidate.photo) {
    return (
      <span
        aria-hidden="true"
        className="grid size-24 shrink-0 place-items-center rounded-card bg-sheet font-heading text-2xl font-semibold text-navy/60 ring-1 ring-hairline ring-inset"
      >
        {initials(candidate.name)}
      </span>
    )
  }

  return (
    <figure className="shrink-0">
      <Image
        src={candidate.photo.imageUrl}
        alt={`Portrait of ${candidate.name}`}
        width={96}
        height={96}
        unoptimized
        className="size-24 rounded-card object-cover"
      />
      <figcaption className="mt-1.5 max-w-24 font-mono text-[9px] leading-tight text-slate-ink/70">
        <a
          href={candidate.photo.filePage}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-brand"
        >
          {candidate.photo.creator ?? "Unknown"}
        </a>
        {" · "}
        {candidate.photo.licenseUrl ? (
          <a
            href={candidate.photo.licenseUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-brand"
          >
            {candidate.photo.licenseName}
          </a>
        ) : (
          candidate.photo.licenseName
        )}
      </figcaption>
    </figure>
  )
}
