import type { ReactNode } from "react"
import { cn } from "cn"
import { Reveal } from "@/components/landing/reveal"

/**
 * Shared section furniture. Every band on the landing page uses the same
 * container width, the same rhythm, and the same heading scale. That
 * repetition is most of what makes the page read as one product rather than
 * eight stacked templates.
 */

export function Container({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-5 sm:px-8", className)}>
      {children}
    </div>
  )
}

export function Section({
  id,
  children,
  className,
  tone = "light",
}: {
  id?: string
  children: ReactNode
  className?: string
  tone?: "light" | "mist" | "navy"
}) {
  return (
    <section
      id={id}
      className={cn(
        "py-8 sm:py-10",
        tone === "mist" && "bg-mist",
        tone === "navy" && "bg-navy text-white",
        className
      )}
    >
      <Container>{children}</Container>
    </section>
  )
}

export function Eyebrow({
  children,
  tone = "brand",
  className,
}: {
  children: ReactNode
  tone?: "brand" | "muted" | "signal" | "inverse"
  className?: string
}) {
  return (
    <p
      className={cn(
        // Martian Mono, small, for a label. Not all-caps and not tracked out:
        // CLAUDE.md lists the tracked-out caps eyebrow as a generated-page
        // tell, and the type spec wants mono used for meta, sparingly.
        "font-mono text-[11px] leading-none tracking-[-0.01em] sm:text-xs",
        tone === "brand" && "text-brand",
        tone === "muted" && "text-slate-ink/80",
        tone === "signal" && "text-signal",
        tone === "inverse" && "text-brand-bright",
        className
      )}
    >
      {children}
    </p>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
  action,
  tone = "dark",
  eyebrowTone,
}: {
  eyebrow: string
  title: ReactNode
  lede?: ReactNode
  action?: ReactNode
  tone?: "dark" | "light"
  eyebrowTone?: "brand" | "muted" | "signal" | "inverse"
}) {
  return (
    <Reveal className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        <Eyebrow tone={eyebrowTone ?? (tone === "light" ? "inverse" : "brand")}>
          {eyebrow}
        </Eyebrow>
        <h2
          className={cn(
            "mt-3 font-heading text-3xl leading-[1.08] font-semibold tracking-[-0.03em] text-balance sm:text-4xl lg:text-[2.6rem]",
            tone === "light" ? "text-white" : "text-navy"
          )}
        >
          {title}
        </h2>
        {lede ? (
          <p
            className={cn(
              "mt-4 text-base leading-relaxed text-pretty sm:text-lg",
              tone === "light" ? "text-white/70" : "text-slate-ink"
            )}
          >
            {lede}
          </p>
        ) : null}
      </div>

      {action ? <div className="shrink-0">{action}</div> : null}
    </Reveal>
  )
}

/** The neutral disclaimer used anywhere the page describes a party or person. */
export function NeutralityNote({
  children,
  tone = "dark",
}: {
  children: ReactNode
  tone?: "dark" | "light"
}) {
  return (
    <p
      className={cn(
        "font-mono text-[11px] leading-relaxed",
        tone === "light" ? "text-white/55" : "text-slate-ink/80"
      )}
    >
      {children}
    </p>
  )
}
