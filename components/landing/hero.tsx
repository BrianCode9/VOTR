import { ArrowRight, BadgeCheck, MapPin, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Container } from "@/components/landing/section"
import { BallotPreview } from "@/components/landing/ballot-preview"

/**
 * Hero.
 *
 * Server-rendered on purpose: the entrance is CSS (tw-animate-css) rather than
 * Motion, so the first thing a user sees costs no JavaScript and cannot flash
 * unstyled while a client bundle loads. Motion is reserved for the scroll
 * reveals further down, where the cost is paid after the page is usable.
 */

const PROOF = [
  { icon: BadgeCheck, label: "Quotes verified against the source" },
  { icon: MapPin, label: "Federal, state and local in one place" },
  { icon: Sparkles, label: "No endorsements, ever" },
]

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-10 pb-20 sm:pt-16 sm:pb-28">
      <HeroBackdrop />

      <Container className="relative">
        <div className="grid items-center gap-14 lg:grid-cols-[1.02fr_0.98fr] lg:gap-12">
          <div>
            <p className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both inline-flex items-center gap-2 rounded-full border border-hairline bg-white/70 py-1.5 pr-3.5 pl-2 text-xs font-medium text-slate-ink shadow-[0_1px_2px_rgba(10,17,36,0.04)] duration-700">
              <span className="rounded-full bg-brand-tint px-2 py-0.5 font-mono text-[10px] tracking-wider text-brand-deep uppercase">
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
                  className="absolute inset-x-0 bottom-1 z-0 h-[0.28em] rounded-full bg-gradient-to-r from-brand-bright/45 to-brand/25"
                />
              </span>
            </h1>

            <p className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both mt-6 max-w-xl text-base leading-relaxed text-pretty text-slate-ink delay-150 duration-700 sm:text-lg">
              Explore candidates, issues, elections and local politics — all in
              one place. We show you what they said and where they stand. What
              you do with it is up to you.
            </p>

            <div className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both mt-8 flex flex-col gap-3 delay-200 duration-700 sm:flex-row sm:items-center">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-full bg-brand px-6 text-base text-white shadow-[0_12px_30px_-12px_var(--color-brand)] hover:bg-brand-deep"
              >
                <a href="#ballot">
                  Explore your ballot
                  <ArrowRight className="size-4" aria-hidden="true" />
                </a>
              </Button>

              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-12 rounded-full border-hairline bg-white px-6 text-base text-navy hover:border-brand/40 hover:bg-white"
              >
                <a href="#trending">Explore issues</a>
              </Button>
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
              className="absolute -top-4 -left-6 hidden rounded-2xl border border-hairline bg-white px-3.5 py-2.5 shadow-[0_18px_40px_-24px_rgba(10,17,36,0.4)] sm:block"
            >
              <p className="font-mono text-[9px] tracking-[0.18em] text-slate-ink/80 uppercase">
                Registered
              </p>
              <p className="mt-0.5 text-sm font-semibold text-navy">You&rsquo;re set</p>
            </div>

            <div
              aria-hidden="true"
              className="absolute -right-4 -bottom-5 hidden items-center gap-2 rounded-2xl border border-hairline bg-navy px-3.5 py-2.5 text-white shadow-[0_18px_40px_-20px_rgba(10,17,36,0.7)] sm:flex"
            >
              <BadgeCheck className="size-4 text-brand-bright" />
              <span className="text-sm font-medium">15 verified quotes today</span>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}

/** Soft blue wash and a grid. No flags, no stars, nothing waving. */
function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 bg-gradient-to-b from-brand-tint/70 via-white to-white" />
      <div className="absolute -top-40 -left-32 size-[34rem] rounded-full bg-brand/12 blur-[120px]" />
      <div className="absolute -top-24 right-[-10rem] size-[30rem] rounded-full bg-brand-bright/14 blur-[130px]" />
      {/* The single red note in the hero, at 5% opacity. */}
      <div className="absolute right-1/3 bottom-0 size-[22rem] rounded-full bg-signal/5 blur-[120px]" />
      <div className="absolute inset-0 [mask-image:radial-gradient(70%_55%_at_50%_0%,black,transparent)] bg-[linear-gradient(to_right,rgba(10,17,36,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(10,17,36,0.045)_1px,transparent_1px)] bg-[size:64px_64px]" />
    </div>
  )
}
