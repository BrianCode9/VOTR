import { Section } from "@/components/landing/section"
import { TopicIcon } from "@/components/landing/topic-icon"
import { StartLink } from "@/components/ballot/start-link"
import { getPolicyAreas } from "@/lib/landing/queries"

/** The issue index. Each tile leads to the reader's ballot. */
export async function PolicyExplorer() {
  const areas = await getPolicyAreas()

  return (
    <Section id="policy" tone="mist">
      <h2 className="font-heading text-2xl font-semibold tracking-[-0.03em] text-navy">
        Issues
      </h2>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {areas.map((area) => (
          <li key={area.id}>
            <StartLink className="group flex h-full items-center gap-3 rounded-card border border-hairline bg-sheet p-4 transition-colors duration-150 hover:border-brand/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-mist text-navy transition-colors group-hover:bg-brand group-hover:text-white">
                <TopicIcon name={area.icon} className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium tracking-[-0.01em] text-navy">
                  {area.title}
                </span>
                <span className="block font-mono text-[10px] text-slate-ink/80">
                  {area.trackedCount} tracked
                </span>
              </span>
            </StartLink>
          </li>
        ))}
      </ul>
    </Section>
  )
}
