import { Section } from "@/components/landing/section"
import { CandidateCard } from "@/components/landing/candidate-card"
import { getFederalCandidates } from "@/lib/landing/queries"

/** Federal races. */
export async function FederalCandidates() {
  const candidates = await getFederalCandidates(4)

  return (
    <Section id="federal" tone="mist">
      <h2 className="font-heading text-2xl font-semibold tracking-[-0.03em] text-navy">
        Federal
      </h2>

      <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <CandidateCard candidate={candidate} />
          </li>
        ))}
      </ul>
    </Section>
  )
}
