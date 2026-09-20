import { Section } from "@/components/landing/section"
import { CandidateCard } from "@/components/landing/candidate-card"
import { readLocation } from "@/lib/location/cookie"
import { stateName } from "@/lib/location/states"
import { getLocalCandidates } from "@/lib/landing/queries"

/** State-level races. Headed by the reader's state once we know it. */
export async function LocalCandidates() {
  const location = await readLocation()
  const candidates = await getLocalCandidates(4)

  return (
    <Section id="local">
      <h2 className="font-heading text-2xl font-semibold tracking-[-0.03em] text-navy">
        {location ? stateName(location.state) : "State races"}
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
