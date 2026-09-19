import { ArrowUpRight } from "lucide-react"
import { Section, SectionHeading } from "@/components/landing/section"
import { Reveal } from "@/components/landing/reveal"
import { TopicIcon } from "@/components/landing/topic-icon"
import { policyAreas } from "@/lib/landing/content"

/**
 * Policy explorer. Denser and flatter than the trending cards on purpose —
 * this is the index you scan, not the feed you read.
 */
export function PolicyExplorer() {
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
            <a
              href="#for-me"
              className="group flex h-full items-start gap-4 rounded-card border border-hairline bg-white p-5 transition-all duration-300 hover:-translate-y-1 hover:border-brand/35 hover:shadow-[0_24px_50px_-30px_rgba(10,17,36,0.4)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-mist text-navy transition-colors group-hover:bg-brand group-hover:text-white">
                <TopicIcon name={area.icon} className="size-5" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="font-heading text-base font-semibold tracking-[-0.02em] text-navy">
                    {area.title}
                  </span>
                  <ArrowUpRight
                    className="size-4 text-slate-ink/35 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand"
                    aria-hidden="true"
                  />
                </span>

                <span className="mt-1 block text-sm leading-snug text-slate-ink">
                  {area.blurb}
                </span>

                <span className="mt-3 block font-mono text-[10px] tracking-wider text-slate-ink/80 uppercase">
                  {area.trackedCount} positions tracked
                </span>
              </span>
            </a>
          </Reveal>
        ))}
      </ul>
    </Section>
  )
}
