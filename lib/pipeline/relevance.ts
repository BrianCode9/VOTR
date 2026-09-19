import type { VerifiedItem } from "../schemas/insight"

/**
 * The static ranking weight stored on every insight.
 *
 * Static is the point. A score that decayed with age would change between two
 * requests, and a keyset cursor over a sort that moves underneath it silently
 * skips and repeats rows. Recency is a separate sort order in the feed query,
 * not a term in here.
 *
 * Everything below is a product of factors in (0, 1], so the result is in
 * (0, 1] and comparable across card types.
 */

/**
 * What each kind of card is worth before any evidence quality is considered.
 *
 * A stance change ranks highest because it is the one thing in the feed a
 * reader cannot get by reading a single article, and it is the card that stops
 * a thumb. A factual claim ranks lowest because on its own it is a sentence
 * someone said, not yet a finding.
 */
const CARD_WEIGHT = {
  stance_change: 1,
  voter_relevance: 0.8,
  stance: 0.65,
  factual_claim: 0.55,
} as const

/**
 * How much the verification rung is trusted.
 *
 * A fuzzy match is still shown, so it is not zero, but it ranks below every
 * lossless rung. A card whose quote had to be corrected should not lead a
 * feed whose whole promise is that the quote is the receipt.
 */
const VERIFICATION_WEIGHT = {
  exact: 1,
  normalized: 0.98,
  transcript: 0.95,
  fuzzy: 0.85,
} as const

/** A checkable claim is more useful than an unfalsifiable one. */
const CHECKABILITY_WEIGHT = {
  easily_checkable: 1,
  requires_expertise: 0.9,
  unverifiable: 0.8,
} as const

/**
 * Floor on the confidence factor.
 *
 * A model that self-rates 0.1 should rank last, not be excluded by arithmetic.
 * Exclusion is a decision the status column makes, not the sort order.
 */
const MIN_CONFIDENCE_FACTOR = 0.3

export function relevanceScore(item: VerifiedItem): number {
  let score = CARD_WEIGHT[item.cardType] * VERIFICATION_WEIGHT[item.quoteVerified]

  score *= Math.max(MIN_CONFIDENCE_FACTOR, Math.min(1, item.confidence))

  if (item.payload.cardType === "factual_claim") {
    score *= CHECKABILITY_WEIGHT[item.payload.checkability]
  }

  // An ambiguous span means the same words appear elsewhere in the document,
  // so "see original" lands on a defensible but possibly unintended passage.
  if (item.occurrences > 1) score *= 0.9

  // A quote the model located nowhere near where it actually sits is a quote
  // it reconstructed rather than copied. It verified, so it is real, but it is
  // weaker evidence of care than one the model could point to.
  if (item.hintDrift > 2000) score *= 0.95

  return Number(score.toFixed(4))
}
