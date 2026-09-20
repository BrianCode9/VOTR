
import { Section, SectionHeading } from "@/components/landing/section"
import { Reveal } from "@/components/landing/reveal"
import { TopicIcon } from "@/components/landing/topic-icon"
import { getPolicyAreas } from "@/lib/landing/queries"
import { StartLink } from "@/components/ballot/start-link"

/**
 * Policy explorer. Denser and flatter than the trending cards on purpose —
 * this is the index you scan, not the feed you read.
 */
export async function PolicyExplorer() {
  const policyAreas = await getPolicyAreas()

  return (
    <Section id="policy" tone="mist">
      <SectionHeading
        eyebrow="Explore policy"
        title="Start with an issue, not a party."
        lede="Pick a subject and see the positions, the tradeoffs and who has voted which way."
      />

      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {policyAreas.map((area, index) => (
          <Reveal as="li" key={area.id} delay={(index % 4) * 0.05}>
            <StartLink className="group flex h-full items-start gap-4 rounded-card border border-hairline bg-sheet p-5 transition-colors duration-150 hover:border-brand/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-mist text-navy transition-colors group-hover:bg-brand group-hover:text-white">
                <TopicIcon name={area.icon} className="size-5" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="font-heading text-base font-semibold tracking-[-0.02em] text-navy">
                    {area.title}
                  </span>
                </span>

                <span className="mt-1 block text-sm leading-snug text-slate-ink">
                  {area.blurb}
                </span>

                <span className="mt-3 block font-mono text-[10px] tracking-wider text-slate-ink/80">
                  {area.trackedCount} positions tracked
                </span>
              </span>
            </StartLink>
          </Reveal>
        ))}
      </ul>
    </Section>
  )
}
