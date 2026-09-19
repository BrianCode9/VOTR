"use client"

import { useId, useState, type FormEvent } from "react"
import { ArrowRight, Check, MapPin, Sparkles } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Container, Eyebrow } from "@/components/landing/section"
import { TopicIcon } from "@/components/landing/topic-icon"
import { issues } from "@/lib/landing/content"

/**
 * "For Me".
 *
 * A personalisation *preview*, not a dashboard: pick issues, drop in a
 * location, see what the feed would become. State is local and nothing is sent
 * anywhere yet — when an account API exists, `handleSubmit` is the only thing
 * that changes.
 *
 * Note what it personalises: which topics you see first, never which candidate
 * you see first. Ordering people by predicted agreement is the exact thing
 * this product refuses to do.
 */
export function ForMe() {
  const addressId = useId()
  const [selected, setSelected] = useState<string[]>(["economy", "housing"])
  const [address, setAddress] = useState("")
  const [saved, setSaved] = useState(false)

  const toggle = (id: string) => {
    setSaved(false)
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    )
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaved(true)
  }

  const chosen = issues.filter((issue) => selected.includes(issue.id))

  return (
    <section id="for-me" className="relative overflow-hidden bg-navy py-20 text-white sm:py-28">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/4 size-[30rem] rounded-full bg-brand/25 blur-[130px]" />
        <div className="absolute -right-24 -bottom-32 size-[26rem] rounded-full bg-brand-bright/12 blur-[120px]" />
      </div>

      <Container className="relative">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div>
            <Eyebrow tone="inverse">For me</Eyebrow>

            <h2 className="mt-3 font-heading text-3xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-4xl lg:text-[2.6rem]">
              Your political information, simplified.
            </h2>

            <p className="mt-4 max-w-md text-base leading-relaxed text-pretty text-white/70 sm:text-lg">
              Tell Votr what you care about and where you vote. We&rsquo;ll put
              those races and issues first — and leave the conclusions to you.
            </p>

            <ul className="mt-8 space-y-3 text-sm text-white/65">
              {[
                "Reorders your feed, never the candidates",
                "Change or clear it whenever you want",
                "Works without an account",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-brand-bright"
                    aria-hidden="true"
                  />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-[1.75rem] border border-navy-line bg-navy-raised/80 p-6 backdrop-blur-sm sm:p-8"
          >
            <fieldset className="border-0 p-0">
              <legend className="font-mono text-[10px] tracking-[0.2em] text-white/55 uppercase">
                Choose your issues
              </legend>

              <div className="mt-4 flex flex-wrap gap-2">
                {issues.map((issue) => {
                  const active = selected.includes(issue.id)
                  return (
                    <button
                      key={issue.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggle(issue.id)}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright",
                        active
                          ? "border-brand-bright bg-brand text-white"
                          : "border-white/15 bg-white/[0.03] text-white/70 hover:border-white/35 hover:text-white"
                      )}
                    >
                      <TopicIcon name={issue.icon} className="size-3.5" />
                      {issue.label}
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <div className="mt-7">
              <label
                htmlFor={addressId}
                className="font-mono text-[10px] tracking-[0.2em] text-white/55 uppercase"
              >
                Where you vote
              </label>

              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <MapPin
                    className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-white/55"
                    aria-hidden="true"
                  />
                  <input
                    id={addressId}
                    name="address"
                    type="text"
                    autoComplete="postal-code"
                    inputMode="text"
                    placeholder="ZIP code or address"
                    value={address}
                    onChange={(event) => {
                      setAddress(event.target.value)
                      setSaved(false)
                    }}
                    className="h-12 w-full rounded-full border border-white/15 bg-white/[0.04] pr-4 pl-10 text-sm text-white transition-colors placeholder:text-white/60 hover:border-white/30 focus:border-brand-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bright/40"
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  disabled={selected.length === 0}
                  className="h-12 shrink-0 rounded-full bg-white px-6 text-base text-navy hover:bg-brand-bright hover:text-white disabled:opacity-40"
                >
                  Build my feed
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div
              aria-live="polite"
              className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5"
            >
              {saved ? (
                <p className="flex items-start gap-2.5 text-sm text-white/80">
                  <Sparkles
                    className="mt-0.5 size-4 shrink-0 text-brand-bright"
                    aria-hidden="true"
                  />
                  <span>
                    Saved on this device. Your feed leads with{" "}
                    <strong className="font-semibold text-white">
                      {chosen.map((issue) => issue.label).join(", ")}
                    </strong>
                    {address ? ` around ${address}` : ""}. Candidate order never
                    changes.
                  </span>
                </p>
              ) : (
                <p className="text-sm text-white/55">
                  {selected.length === 0
                    ? "Pick at least one issue to preview your feed."
                    : `${selected.length} ${
                        selected.length === 1 ? "issue" : "issues"
                      } selected · ${chosen
                        .slice(0, 3)
                        .map((issue) => issue.label)
                        .join(", ")}${selected.length > 3 ? ` +${selected.length - 3}` : ""}`}
                </p>
              )}
            </div>
          </form>
        </div>
      </Container>
    </section>
  )
}
