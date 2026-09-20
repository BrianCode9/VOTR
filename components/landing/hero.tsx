import { BadgeCheck, MapPin, Sparkles } from "lucide-react"
import { Container } from "@/components/landing/section"
import { BallotPreview } from "@/components/landing/ballot-preview"
import { LocationForm } from "@/components/ballot/location-form"

/**
 * Hero.
 *
 * Server-rendered on purpose: the entrance is CSS (tw-animate-css) rather than
 * Motion, so the first thing a user sees costs no JavaScript and cannot flash
 * unstyled while a client bundle loads. Motion is reserved for the scroll
 * reveals further down, where the cost is paid after the page is usable.
 *
 * The hero used to carry two buttons, "Explore your ballot" and "Explore
 * issues", both of which scrolled to another section of this same page. They
 * are now the one form that actually starts the product. Asking the reader
 * where they vote is the entire entry flow, so it belongs above the fold and
 * not eight sections down.
 */

const PROOF = [
  { icon: BadgeCheck, label: "Quotes verified against the source" },
  { icon: MapPin, label: "Federal, state and local in one place" },
  { icon: Sparkles, label: "No endorsements, ever" },
]

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
    <section className="relative overflow-hidden pt-10 pb-20 sm:pt-16 sm:pb-28">
      <HeroBackdrop />

      <Container className="relative">
        <div className="grid items-center gap-14 lg:grid-cols-[1.02fr_0.98fr] lg:gap-12">
          <div>
            <p className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both inline-flex items-center gap-2 rounded-full border border-hairline bg-sheet/70 py-1.5 pr-3.5 pl-2 text-xs font-medium text-slate-ink shadow-[0_1px_2px_rgba(10,17,36,0.04)] duration-700">
              <span className="rounded-full bg-brand-tint px-2 py-0.5 font-mono text-[10px] tracking-wider text-brand-deep">
                New
              </span>
              Built for first-time and every-time voters
            </p>

            <h1 className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both mt-6 font-heading text-[clamp(2.5rem,7.5vw,4.25rem)] leading-[0.98] font-semibold tracking-[-0.045em] text-balance text-navy delay-75 duration-700">
              Politics,
              <br />
              made easier to{" "}
              <span className="relative inline-block">
                <span className="relative z-10">understand.</span>
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-1 z-0 h-[0.28em] bg-brand/20"
                />
              </span>
            </h1>

            <p className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both mt-6 max-w-xl text-base leading-relaxed text-pretty text-slate-ink delay-150 duration-700 sm:text-lg">
              Explore candidates, issues, elections and local politics — all in
              one place. We show you what they said and where they stand. What
              you do with it is up to you.
            </p>

            <div
              id="start"
              className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both mt-8 delay-200 duration-700"
            >
              {/* Only reachable without JavaScript, where the select's
                  `required` cannot stop an empty submit. Silence there would
                  look like a button that does nothing, which is the bug this
                  whole refactor is about. */}
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

            <ul className="animate-in fade-in fill-mode-both mt-10 flex flex-col gap-3 delay-300 duration-700 sm:flex-row sm:flex-wrap sm:gap-x-6">
              {PROOF.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex items-center gap-2 text-sm text-slate-ink/80"
                >
                  <Icon className="size-4 shrink-0 text-brand" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <div className="animate-in fade-in slide-in-from-bottom-4 fill-mode-both relative delay-200 duration-1000">
            <div className="motion-safe:animate-drift">
              <BallotPreview />
            </div>

            {/* Floating accents. Hidden below sm so nothing can push the page
                sideways on a phone. */}
            <div
              aria-hidden="true"
              className="absolute -top-4 -left-6 hidden rounded-2xl border border-hairline bg-sheet px-3.5 py-2.5 sm:block"
            >
              <p className="font-mono text-[9px] tracking-[-0.01em] text-slate-ink/80">
                Registered
              </p>
              <p className="mt-0.5 text-sm font-semibold text-navy">You&rsquo;re set</p>
            </div>

            <div
              aria-hidden="true"
              className="absolute -right-4 -bottom-5 hidden items-center gap-2 rounded-2xl border border-hairline bg-navy px-3.5 py-2.5 text-white sm:flex"
            >
              <BadgeCheck className="size-4 text-brand-bright" />
              <span className="text-sm font-medium">Quotes checked to the character</span>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}

/**
 * Ruled paper.
 *
 * This was a blue wash plus three blurred colour orbs plus a grid. The wash and
 * the orbs are on CLAUDE.md's list of generated-page defaults, so they are
 * gone. The rule lines stay because they are the one part that meant
 * something: the product is built on annotated documents, and a ruled sheet is
 * that, not decoration borrowed from a template.
 */
function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(10,17,36,0.05)_1px,transparent_1px)] bg-[size:100%_32px]" />
    </div>
  )
}
