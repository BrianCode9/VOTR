import { z } from "zod"

/**
 * How strongly a quote supports the thing the card says it supports.
 *
 * This is the THIRD confidence number in the system and the only one a reader
 * ever sees, so the distinction between the three is worth stating once, here,
 * rather than being rediscovered at each call site:
 *
 *   1. `insights.quote_similarity` - TEXTUAL. Did the model copy the quote
 *      correctly? Produced by the verification ladder in lib/extract/verify.ts
 *      as a Levenshtein ratio against the stored document. A quote can score
 *      1.0 here and still be weak evidence for the claim attached to it.
 *
 *   2. `stance_change.confidence` (stored in `insights.extractor_confidence`
 *      for that card type) - EVENTIVE. Did a change of position actually
 *      happen, as opposed to a rewording? It gates the FLIP_FLOP badge, see
 *      lib/flags/assign.ts.
 *
 *   3. `insights.claim_support_confidence` - SEMANTIC, and what this module is
 *      about. Given that the quote is real, how directly does it support the
 *      stated claim, position, or framing? Low means the card is an inference
 *      the reader should check rather than a thing the speaker plainly said.
 *
 * Nothing here reads the database. The label, the verify-yourself flag, and
 * the presentation mode are all pure functions of a score and a threshold
 * pair, which is what lets them be computed identically at write time (so they
 * are queryable columns) and at read time (so a fixture or a test does not
 * need a round trip).
 */

export const CONFIDENCE_LABELS = ["high", "medium", "low"] as const
export const confidenceLabelSchema = z.enum(CONFIDENCE_LABELS)
export type ConfidenceLabel = z.infer<typeof confidenceLabelSchema>

/**
 * What the frontend is allowed to do with the card, as one value.
 *
 * Exists so the client never re-derives a presentation rule from a raw float.
 * A threshold change then ships from the backend alone, and two surfaces
 * cannot disagree about where the line is.
 *
 *   stated       - render the claim as the card states it.
 *   nudge_verify - never render it as flatly stated fact. Show the quote, show
 *                  the "check this yourself" affordance, and link the source.
 */
export const PRESENTATION_MODES = ["stated", "nudge_verify"] as const
export const presentationModeSchema = z.enum(PRESENTATION_MODES)
export type PresentationMode = z.infer<typeof presentationModeSchema>

export interface ConfidenceThresholds {
  /** At or above this, the label is `high`. */
  high: number
  /** At or above this (and below `high`), `medium`. Below it, `low`. */
  medium: number
}

/**
 * The default cut points.
 *
 * `medium: 0.5` is the one the product brief names: below half, the card is
 * not presented as something the speaker plainly said. `high: 0.8` is the
 * weaker of the two decisions - it only changes a badge - and is set where a
 * self-rating stops being hedged.
 */
export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  high: 0.8,
  medium: 0.5,
}

/**
 * Read the thresholds from the environment.
 *
 * Same blank-string care as flagOptionsFromEnv: `Number("")` is 0, and an
 * env var that is present but empty must not silently become a threshold of
 * zero, which would label every insight `high`. Anything that is not a number
 * in [0, 1] falls back to the default, and an inverted pair (medium above
 * high) is rejected as a pair rather than half-applied.
 */
export function confidenceThresholdsFromEnv(
  env: Record<string, string | undefined> = process.env,
): ConfidenceThresholds {
  const high = number(env.CONFIDENCE_HIGH_THRESHOLD, DEFAULT_CONFIDENCE_THRESHOLDS.high)
  const medium = number(env.CONFIDENCE_MEDIUM_THRESHOLD, DEFAULT_CONFIDENCE_THRESHOLDS.medium)

  if (medium > high) return DEFAULT_CONFIDENCE_THRESHOLDS
  return { high, medium }
}

function number(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim()
  if (!trimmed) return fallback
  const value = Number(trimmed)
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback
}

/**
 * Score to label.
 *
 * A null or non-finite score is `low`, not `medium`. An insight nothing rated
 * is exactly the case the verify-yourself nudge exists for, and defaulting it
 * to the middle would present an unrated inference as a stated fact.
 */
export function confidenceLabel(
  score: number | null | undefined,
  thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS,
): ConfidenceLabel {
  if (score === null || score === undefined || !Number.isFinite(score)) return "low"
  if (score >= thresholds.high) return "high"
  if (score >= thresholds.medium) return "medium"
  return "low"
}

/** True exactly when the label is `low`. The brief's rule, in one place. */
export function verifyYourself(label: ConfidenceLabel): boolean {
  return label === "low"
}

/** The presentation mode implied by a label. */
export function presentationMode(label: ConfidenceLabel): PresentationMode {
  return verifyYourself(label) ? "nudge_verify" : "stated"
}

/**
 * Everything derived from one score, as the four columns the row carries.
 *
 * Callers use this rather than the three functions separately so that a row
 * can never be written with a label that disagrees with its flag, which is the
 * failure mode of storing derived values at all.
 */
export interface ConfidenceFields {
  claimSupportConfidence: number | null
  confidenceLabel: ConfidenceLabel
  verifyYourself: boolean
  presentationMode: PresentationMode
}

export function confidenceFields(
  score: number | null | undefined,
  thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS,
): ConfidenceFields {
  const label = confidenceLabel(score, thresholds)
  const clamped =
    score === null || score === undefined || !Number.isFinite(score)
      ? null
      : Math.max(0, Math.min(1, score))

  return {
    claimSupportConfidence: clamped,
    confidenceLabel: label,
    verifyYourself: verifyYourself(label),
    presentationMode: presentationMode(label),
  }
}

export function isConfidenceLabel(value: string): value is ConfidenceLabel {
  return (CONFIDENCE_LABELS as readonly string[]).includes(value)
}

export function isPresentationMode(value: string): value is PresentationMode {
  return (PRESENTATION_MODES as readonly string[]).includes(value)
}
