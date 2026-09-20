import type { ReactNode } from "react"

/**
 * Layout wrapper. Renders its children and nothing else.
 *
 * This used to fade-and-slide every section in on scroll. CLAUDE.md lists
 * "fade-and-slide-up entrances on every section" among the patterns that make
 * a page read as generated, and for this product reading as generated is
 * fatal: the entire claim is that a person checked the record, so the surface
 * has to look built rather than produced.
 *
 * The design system allows exactly one orchestrated motion, the highlight
 * sweep on a verified quote, and that lives in the feed card where it means
 * something. Everything else here responds to a user action instead.
 *
 * Kept as a component rather than deleted at ~15 call sites so the section
 * rhythm stays legible in the markup, and so reinstating a motion decision
 * later is one file rather than fifteen.
 */

const ELEMENTS = {
  div: "div",
  section: "section",
  li: "li",
} as const

export function Reveal({
  children,
  className,
  as = "div",
}: {
  children: ReactNode
  /** Accepted and ignored. Call sites still stagger conceptually. */
  delay?: number
  className?: string
  as?: keyof typeof ELEMENTS
}) {
  const Component = ELEMENTS[as]
  return <Component className={className}>{children}</Component>
}
