"use client"

import type { ReactNode } from "react"
import { motion } from "motion/react"

/**
 * Scroll reveal. Deliberately small: 14px of travel, one shot, and it never
 * re-runs when you scroll back up, because a page that re-animates on every
 * pass feels cheap rather than polished.
 *
 * Motion honours prefers-reduced-motion for transforms on its own, and
 * globals.css collapses durations as a backstop.
 */

const ELEMENTS = {
  div: motion.div,
  section: motion.section,
  li: motion.li,
} as const

export function Reveal({
  children,
  delay = 0,
  className,
  as = "div",
}: {
  children: ReactNode
  delay?: number
  className?: string
  as?: keyof typeof ELEMENTS
}) {
  const Component = ELEMENTS[as]

  return (
    <Component
      // Motion server-renders the `initial` state, so without JS every
      // revealed block would stay at opacity 0. The noscript rule in the root
      // layout targets this attribute and puts them all back.
      data-reveal=""
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Component>
  )
}
