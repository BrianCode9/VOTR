import { Container } from "@/components/landing/section"
import { Reveal } from "@/components/landing/reveal"
import { VotrMark } from "@/components/brand/votr-logo"
import { LocationForm } from "@/components/ballot/location-form"

/**
 * The closing band.
 *
 * It asks the same question the hero does, with the same form, rather than
 * offering a second "Get started" button that scrolled back up the page. A
 * reader who has scrolled the whole way should be able to start from where
 * they are.
 */
export function FinalCta({
  availableStates,
  savedState,
}: {
  availableStates: string[]
  savedState?: string | null
}) {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] border border-hairline bg-brand-tint px-6 py-16 text-center sm:px-10 sm:py-20">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(10,17,36,0.05)_1px,transparent_1px)] bg-[size:100%_32px]" />
            </div>

            <div className="relative mx-auto max-w-2xl">
              <VotrMark size={44} className="mx-auto" />

              <h2 className="mt-7 font-heading text-[clamp(2rem,6vw,3.25rem)] leading-[1.02] font-semibold tracking-[-0.04em] text-balance text-navy">
                Know your ballot.
                <br />
                Own your vote.
              </h2>

              <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-pretty text-slate-ink sm:text-lg">
                Free, nonpartisan, and built to hand you the information rather
                than the conclusion.
              </p>

              <div className="mt-9 text-left">
                <LocationForm
                  available={availableStates}
                  defaultState={savedState}
                />
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
