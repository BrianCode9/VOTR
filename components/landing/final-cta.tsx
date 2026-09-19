import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Container } from "@/components/landing/section"
import { Reveal } from "@/components/landing/reveal"
import { VotrMark } from "@/components/brand/votr-logo"

export function FinalCta() {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] border border-hairline bg-brand-tint px-6 py-16 text-center sm:px-10 sm:py-20">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <div className="absolute -top-28 left-1/2 size-[30rem] -translate-x-1/2 rounded-full bg-brand/12 blur-[110px]" />
              <div className="absolute inset-0 [mask-image:radial-gradient(60%_60%_at_50%_50%,black,transparent)] bg-[linear-gradient(to_right,rgba(10,17,36,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(10,17,36,0.05)_1px,transparent_1px)] bg-[size:56px_56px]" />
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

              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="h-12 w-full rounded-full bg-navy px-7 text-base text-white shadow-[0_14px_34px_-14px_rgba(10,17,36,0.6)] hover:bg-brand sm:w-auto"
                >
                  <a href="#for-me">
                    Get started
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </a>
                </Button>

                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="h-12 w-full rounded-full border-hairline bg-white px-7 text-base text-navy hover:border-brand/40 hover:bg-white sm:w-auto"
                >
                  <Link href="/feed">Read verified quotes</Link>
                </Button>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
