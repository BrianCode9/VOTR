import { Container } from "@/components/landing/section"
import { LocationForm } from "@/components/ballot/location-form"

/**
 * Hero.
 *
 * One column: the headline, then the form that starts the product.
 *
 * It was a two-column grid with a mocked-up sample ballot filling the right
 * half, which left the address field about a third of half the page. The
 * mockup was decoration built from fake races, so the width goes to the one
 * control the whole site depends on.
 */
export function Hero({
  availableStates,
  savedState,
  unresolved = false,
}: {
  availableStates: string[]
  savedState?: string | null
  /** The action bounced the reader back because it could read no location. */
  unresolved?: boolean
}) {
  return (
    <section className="relative overflow-hidden pt-10 pb-8 sm:pt-14 sm:pb-10">
      <HeroBackdrop />

      <Container className="relative">
        <div className="max-w-3xl">
          <h1 className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both font-heading text-[clamp(2.5rem,7vw,4rem)] leading-[1] font-semibold tracking-[-0.045em] text-balance text-navy duration-700">
            Politics, made easier to{" "}
            <span className="relative inline-block">
              <span className="relative z-10">understand.</span>
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-1 z-0 h-[0.28em] bg-brand/20"
              />
            </span>
          </h1>

          <div
            id="start"
            className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both mt-8 delay-150 duration-700"
          >
            {/* Only reachable without JavaScript, where the select's `required`
                cannot stop an empty submit. */}
            {unresolved ? (
              <p
                role="status"
                className="mb-3 rounded-2xl border border-signal/30 bg-signal-tint px-4 py-2.5 text-sm text-signal-ink"
              >
                We could not tell where you vote. Choose a state below and try
                again.
              </p>
            ) : null}

            <LocationForm
              available={availableStates}
              defaultState={savedState}
              className="shadow-[0_18px_40px_-28px_var(--color-navy)]"
            />
          </div>
        </div>
      </Container>
    </section>
  )
}

/**
 * Ruled paper. The product is built on annotated documents, and a ruled sheet
 * is that rather than decoration borrowed from a template.
 */
function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(10,17,36,0.05)_1px,transparent_1px)] bg-[size:100%_32px]" />
    </div>
  )
}
