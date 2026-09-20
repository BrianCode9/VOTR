import { Flame } from "lucide-react"
import { Section } from "@/components/landing/section"
import { Reveal } from "@/components/landing/reveal"
import { TopicIcon } from "@/components/landing/topic-icon"
import { getTopics } from "@/lib/landing/queries"
import { StartLink } from "@/components/ballot/start-link"

/**
 * Trending topics.
 *
 * Grid on desktop, snap-scrolling rail on phones. The rail is a real overflow
 * container with negative gutters so cards bleed to the screen edge the way a
 * native app's would, without the page itself ever scrolling sideways.
 */
export async function TrendingTopics() {
  const topics = (await getTopics()).slice(0, 6)

  return (
    <Section id="trending">
      <ul className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-4 sm:-mx-8 sm:px-8 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-4">
        {topics.map((topic, index) => (
          <Reveal
            as="li"
            key={topic.id}
            delay={(index % 4) * 0.06}
            className="w-[17rem] shrink-0 snap-start md:w-auto md:shrink"
          >
            <StartLink className="group flex h-full flex-col rounded-card border border-hairline bg-sheet p-5 transition-colors duration-150 hover:border-brand/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-11 place-items-center rounded-xl bg-brand-tint text-brand transition-colors group-hover:bg-brand group-hover:text-white">
                  <TopicIcon name={topic.icon} className="size-5" />
                </span>

                {topic.trending ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-signal-tint px-2 py-0.5 font-mono text-[9px] tracking-[-0.01em] text-signal-ink">
                    <Flame className="size-3" aria-hidden="true" />
                    Hot
                  </span>
                ) : null}
              </div>

              <h3 className="mt-5 font-heading text-lg font-semibold tracking-[-0.02em] text-navy">
                {topic.title}
              </h3>

              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-ink">
                {topic.blurb}
              </p>

              <div className="mt-5 flex items-center justify-between border-t border-hairline pt-4">
                <span className="font-mono text-[10px] tracking-wider text-slate-ink/80">
                  {topic.meta}
                </span>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-brand">
                  Explore
                </span>
              </div>
            </StartLink>
          </Reveal>
        ))}
      </ul>
    </Section>
  )
}
