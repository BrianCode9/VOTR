import { Section } from "@/components/landing/section"
import { partyViews } from "@/lib/landing/content"

/**
 * Party positions.
 *
 * The cards are deliberately identical: same border, same type, same order of
 * information, and no red or blue tinting per party.
 */
export function PartyBeliefs() {
  return (
    <Section id="parties" tone="mist">
      <h2 className="font-heading text-2xl font-semibold tracking-[-0.03em] text-navy">
        Parties
      </h2>

      <div className="mt-6 grid gap-5 md:grid-cols-3">
        {partyViews.map((party) => (
          <article
            key={party.id}
            className="flex h-full flex-col rounded-card border border-hairline bg-sheet p-5"
          >
            <h3 className="font-heading text-lg font-semibold tracking-[-0.02em] text-navy">
              {party.name}
            </h3>

            <dl className="mt-4 space-y-3 border-t border-hairline pt-4">
              {party.positions.map((position) => (
                <div key={position.issue} className="flex gap-3">
                  <dt className="w-24 shrink-0 font-mono text-[10px] tracking-wider text-slate-ink/80">
                    {position.issue}
                  </dt>
                  <dd className="flex-1 text-sm leading-snug text-navy">
                    {position.stance}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </Section>
  )
}
