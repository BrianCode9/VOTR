import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { PositionCard } from "@/components/ballot/position-card"
import { Container } from "@/components/landing/section"
import { SiteNav } from "@/components/landing/site-nav"
import { SiteFooter } from "@/components/landing/site-footer"
import { TopicIcon } from "@/components/landing/topic-icon"
import { stateByCode } from "@/lib/location/states"
import { getBallotTopics } from "@/lib/queries/ballot"
import { getInsightFeed } from "@/lib/queries/feed"
import { iconFor } from "@/lib/topics/icons"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/ballot/[state]/topic/[slug]">): Promise<Metadata> {
  const { state, slug } = await params
  const info = stateByCode(state)
  if (!info) return { title: "Topic" }

  const topic = (await getBallotTopics(info.code)).find((t) => t.slug === slug)
  if (!topic) return { title: "Topic" }

  return {
    title: `${topic.label} in ${info.name}`,
    description: `What candidates on the ${info.name} ballot have said about ${topic.label.toLowerCase()}, quoted from the source.`,
  }
}

/**
 * One issue, across a whole ballot.
 *
 * The other half of the dashboard: a reader either wants to know about a
 * person or about a subject, and this is the subject half. Grouping is by
 * candidate rather than by date, because the question being asked here is
 * "where does each of them stand", not "what happened recently".
 *
 * Candidates are ordered by name. Never by how much they have said, which
 * would quietly reward whoever we happen to have scanned most.
 */
export default async function TopicPage({
  params,
}: PageProps<"/ballot/[state]/topic/[slug]">) {
  const { state, slug } = await params

  const info = stateByCode(state)
  if (!info) notFound()

  const topics = await getBallotTopics(info.code)
  const topic = topics.find((t) => t.slug === slug)
  // A topic with no coverage in this state has no page. Better a 404 than a
  // page that implies we looked and found silence.
  if (!topic) notFound()

  const { items } = await getInsightFeed({
    state: info.code,
    topics: [slug],
    limit: 50,
  })
  const positions = items.filter((item) => item.quote.trim().length > 0)

  const byCandidate = new Map<string, typeof positions>()
  for (const item of positions) {
    const key = item.candidateName ?? "Unattributed"
    byCandidate.set(key, [...(byCandidate.get(key) ?? []), item])
  }
  const grouped = [...byCandidate.entries()].sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="flex min-h-dvh flex-col bg-sheet">
      <SiteNav />

      <main id="main" className="flex-1">
        <section className="border-b border-hairline bg-mist py-10 sm:py-12">
          <Container>
            <Link
              href={`/ballot/${info.code}`}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[-0.01em] text-slate-ink transition-colors hover:text-brand"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              {info.name} ballot
            </Link>

            <div className="mt-5 flex items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-card bg-sheet ring-1 ring-hairline ring-inset">
                <TopicIcon name={iconFor(slug)} className="size-5 text-brand" />
              </span>

              <div>
                <h1 className="font-heading text-3xl leading-[1.05] font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
                  {topic.label} in {info.name}
                </h1>
                <p className="mt-2 max-w-xl text-base leading-relaxed text-slate-ink">
                  Every verified thing candidates on this ballot have said about{" "}
                  {topic.label.toLowerCase()}, in their own words. Listed by
                  name, not by agreement with anything.
                </p>
              </div>
            </div>
          </Container>
        </section>

        <Container className="py-10 sm:py-14">
          <div className="max-w-3xl space-y-10">
            {grouped.map(([name, group]) => (
              <section key={name}>
                <div className="flex items-baseline gap-3 border-b border-hairline pb-2.5">
                  <h2 className="font-heading text-lg font-semibold tracking-[-0.02em] text-navy">
                    {name}
                  </h2>
                  <span className="font-mono text-[11px] text-slate-ink/80">
                    {group.length === 1 ? "1 position" : `${group.length} positions`}
                  </span>
                </div>

                <div className="mt-4 space-y-4">
                  {group.map((item) => (
                    <PositionCard key={item.id} item={item} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {topics.length > 1 ? (
            <div className="mt-14 border-t border-hairline pt-6">
              <p className="font-mono text-[10px] tracking-[-0.01em] text-slate-ink/80">
                Other issues on this ballot
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {topics
                  .filter((t) => t.slug !== slug)
                  .map((t) => (
                    <Link
                      key={t.slug}
                      href={`/ballot/${info.code}/topic/${t.slug}`}
                      className="inline-flex items-center gap-2 rounded-full border border-hairline bg-mist px-3.5 py-1.5 text-sm font-medium text-slate-ink transition-colors hover:border-brand/40 hover:text-navy"
                    >
                      <TopicIcon name={iconFor(t.slug)} className="size-3.5 text-brand" />
                      {t.label}
                      <span className="font-mono text-[10px] text-slate-ink/70">
                        {t.count}
                      </span>
                    </Link>
                  ))}
              </div>
            </div>
          ) : null}
        </Container>
      </main>

      <SiteFooter />
    </div>
  )
}
