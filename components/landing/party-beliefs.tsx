import { ArrowRight } from "lucide-react"
import { cn } from "cn"
import { Section, SectionHeading, NeutralityNote } from "@/components/landing/section"
import { Reveal } from "@/components/landing/reveal"
import { partyViews } from "@/lib/landing/content"

/**
 * Party belief summary.
 *
 * The cards are deliberately identical: same border, same type, same order of
 * information, and no red or blue tinting per party. The only thing that moves
 * between them is a three-segment position marker, which is a location on a
 * spectrum, not a verdict about it.
 */
export function PartyBeliefs() {
  return (
    <Section id="parties" tone="mist">
      <SectionHeading
        eyebrow="Party belief summary"
        title="Understand where parties stand on the issues."
        lede="A plain-language read of what each side generally argues for. Same format, same length, no thumb on the scale."
      />

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {partyViews.map((party, index) => (
          <Reveal key={party.id} delay={index * 0.07}>
            <article className="group flex h-full flex-col rounded-card border border-hairline bg-white p-6 transition-all duration-300 hover:-translate-y-1 hover:border-brand/35 hover:shadow-[0_24px_50px_-30px_rgba(10,17,36,0.4)]">
              <PositionMarker index={index} label={party.shortName} />

              <h3 className="mt-5 font-heading text-xl font-semibold tracking-[-0.02em] text-navy">
                {party.name}
              </h3>

              <p className="mt-3 text-sm leading-relaxed text-slate-ink">
                {party.summary}
              </p>

              <dl className="mt-6 space-y-3 border-t border-hairline pt-5">
                {party.positions.map((position) => (
                  <div key={position.issue} className="flex gap-3">
                    <dt className="w-24 shrink-0 font-mono text-[10px] tracking-wider text-slate-ink/80 uppercase">
                      {position.issue}
                    </dt>
                    <dd className="flex-1 text-sm leading-snug text-navy">
                      {position.stance}
                    </dd>
                  </div>
                ))}
              </dl>

              <a
                href="#policy"
                className="mt-6 inline-flex items-center gap-1.5 self-start rounded-lg text-sm font-medium text-brand transition-colors hover:text-brand-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Learn more
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </a>
            </article>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-8">
        <NeutralityNote>
          These summaries describe stated party platforms, not individual
          candidates — plenty of them break with their party. Votr does not rank
          parties or tell you which one to pick.
        </NeutralityNote>
      </Reveal>
    </Section>
  )
}

/** Where the card sits on a left-to-right spectrum. Navy only, no party colors. */
function PositionMarker({ index, label }: { index: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((slot) => (
          <span
            key={slot}
            className={cn(
              "h-1.5 rounded-full transition-colors",
              slot === index ? "w-6 bg-navy" : "w-1.5 bg-hairline"
            )}
          />
        ))}
      </div>
      <span className="font-mono text-[10px] tracking-[0.18em] text-slate-ink/80 uppercase">
        {label}
      </span>
    </div>
  )
}
