import { Landmark } from "lucide-react"
import { Section, SectionHeading, NeutralityNote } from "@/components/landing/section"
import { Reveal } from "@/components/landing/reveal"
import { CandidateCard } from "@/components/landing/candidate-card"
import { getFederalCandidates } from "@/lib/landing/queries"
import { StartLink } from "@/components/ballot/start-link"

export async function FederalCandidates() {
  const federalCandidates = await getFederalCandidates(4)

  return (
    <Section id="federal" tone="mist">
      <SectionHeading
        eyebrow="Federal candidates"
        title="The names on the national ballot."
        lede="U.S. Senate and U.S. House races for your state and district, with what each candidate is actually running on."
        action={
          <StartLink className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-brand transition-colors hover:text-brand-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            See all federal races
          </StartLink>
        }
      />

      <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {federalCandidates.map((candidate, index) => (
          <Reveal as="li" key={candidate.id} delay={(index % 4) * 0.06}>
            <CandidateCard candidate={candidate} />
          </Reveal>
        ))}
      </ul>

      <Reveal className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-navy">
          <Landmark className="size-4 text-brand" aria-hidden="true" />
          Listed by office, then surname
        </span>
        <NeutralityNote>
          Never ranked, scored or recommended. Sample candidates until you set a
          location.
        </NeutralityNote>
      </Reveal>
    </Section>
  )
}
