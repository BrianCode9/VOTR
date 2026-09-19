"use client"

import { useId } from "react"
import Image from "next/image"
import { cn } from "cn"

/**
 * The Votr lockup.
 *
 * The mark is inlined as SVG rather than pulled from `/votr-logo.svg` so it can
 * carry a per-instance gradient id and scale crisply inside buttons. The same
 * artwork lives at `public/votr-logo.svg` for favicons, OG images and anywhere
 * outside React.
 *
 * Swapping in a real brand asset later is a one-file change: point `src` at it
 * and flip `useAsset` to true. Nothing in the layout depends on the mark being
 * inline, only on it being a square that fits `size`.
 */

const SIZES = {
  sm: { box: 24, text: "text-lg" },
  md: { box: 32, text: "text-xl" },
  lg: { box: 40, text: "text-2xl" },
} as const

/** Flip to true once a designed asset replaces the placeholder artwork. */
const useAsset = false

export function VotrLogo({
  size = "md",
  showWordmark = true,
  tone = "dark",
  className,
}: {
  size?: keyof typeof SIZES
  showWordmark?: boolean
  /** "dark" renders navy type for light backgrounds, "light" the inverse. */
  tone?: "dark" | "light"
  className?: string
}) {
  const { box, text } = SIZES[size]

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {useAsset ? (
        <Image
          src="/votr-logo.svg"
          alt=""
          width={box}
          height={box}
          className="shrink-0"
        />
      ) : (
        <VotrMark size={box} />
      )}

      {showWordmark ? (
        <span
          className={cn(
            "font-heading font-semibold tracking-[-0.045em]",
            tone === "dark" ? "text-navy" : "text-white",
            text
          )}
        >
          Votr
          <span className="text-brand">.</span>
        </span>
      ) : null}
    </span>
  )
}

export function VotrMark({
  size = 32,
  className,
}: {
  size?: number
  className?: string
}) {
  // The mark appears several times per page (nav, mobile sheet, CTA, footer).
  // A hardcoded gradient id would be duplicated across all of them, which is
  // invalid and leaves every instance pointing at whichever one parsed first.
  // React's id contains punctuation that has no business in a URL fragment,
  // so strip it down to word characters.
  const gradientId = `votr-mark-${useId().replace(/[^a-zA-Z0-9]/g, "")}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="6"
          y1="4"
          x2="42"
          y2="44"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--color-brand-bright)" />
          <stop offset="1" stopColor="var(--color-brand-deep)" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#${gradientId})`} />
      {/* Reads as a checkmark and as the V of Votr, depending on how long you look. */}
      <path
        d="M14 20.5 L22.5 33 L34.5 15"
        stroke="#FFFFFF"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
