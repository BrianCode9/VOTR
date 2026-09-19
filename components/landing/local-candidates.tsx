import { ArrowRight, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Section, Eyebrow, NeutralityNote } from "@/components/landing/section"
import { Reveal } from "@/components/landing/reveal"
import { CandidateCard } from "@/components/landing/candidate-card"
import { localCandidates } from "@/lib/landing/content"

const OFFICE_TYPES = [
  "Mayor & city council",
  "School board",
  "Sheriff, judges & DA",
  "County commission",
]

/**
 * Local candidates.
 *
 * Given more room than the federal band on purpose. Down-ballot races are the
 * ones people actually skip, and they are the reason this product exists.
 */
export function LocalCandidates() {
  return (
    <Section id="local">
      <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
        <Reveal>
          <div className="lg:sticky lg:top-28">
            <Eyebrow>Local candidates</Eyebrow>

            <h2 className="mt-3 font-heading text-3xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance text-navy sm:text-4xl lg:text-[2.6rem]">
              See who&rsquo;s running where you live.
            </h2>

            <p className="mt-4 text-base leading-relaxed text-pretty text-slate-ink sm:text-lg">
              The races at the bottom of the ballot are the ones that set your
              rent rules, your school budget and your bus routes — and the ones
              most people leave blank.
            </p>

            <ul className="mt-8 space-y-2.5">
              {OFFICE_TYPES.map((office) => (
                <li
                  key={office}
                  className="flex items-center gap-3 text-sm font-medium text-navy"
                >
                  <span
                    className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-tint"
                    aria-hidden="true"
                  >
                    <MapPin className="size-3.5 text-brand" />
                  </span>
                  {office}
                </li>
              ))}
            </ul>

            <Button
              asChild
              size="lg"
              className="mt-8 h-12 rounded-full bg-navy px-6 text-base text-white hover:bg-brand"
            >
              <a href="#for-me">
                Find my local races
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </Button>
          </div>
        </Reveal>

        <div>
          <ul className="grid gap-5 sm:grid-cols-2">
            {localCandidates.map((candidate, index) => (
              <Reveal as="li" key={candidate.id} delay={(index % 2) * 0.07}>
                <CandidateCard candidate={candidate} />
              </Reveal>
            ))}
          </ul>

          <Reveal className="mt-6">
            <NeutralityNote>
              Partisan, nonpartisan and independent candidates appear together,
              in the same format, in ballot order. Votr does not rank them.
            </NeutralityNote>
          </Reveal>
        </div>
      </div>
    </Section>
  )
}
