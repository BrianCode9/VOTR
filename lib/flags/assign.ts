import { similarity } from "../extract/fuzzy"
import type { CardType, InsightPayload } from "../schemas/insight"
import type { FactCheckStatus, InsightFlag } from "./types"

/**
 * Flag assignment.
 *
 * A pure function over one insight and the facts the pipeline already knows
 * about it. Everything that needs a database - "has this speaker said anything
 * about this topic before" - is resolved by the caller and handed in as a
 * boolean, so the rules themselves can be tested exhaustively without one.
 *
 * Why assign at write time at all, rather than deriving badges on read: the
 * feed filters and sorts on flags. Deriving NEW at read time would mean, for
 * every row of every page, a correlated lookup for an earlier row with the
 * same speaker and topic. Stored, it is an index scan.
 *
 * The cost of storing is that a flag records what was true when the row was
 * written and is not recomputed afterwards. For NEW that is not a compromise
 * but the intended meaning: an insight that was the first of its kind stays
 * NEW even after later ones arrive, which is what a reader means by new.
 */

/**
 * Confidence floor for FLIP_FLOP.
 *
 * A false flip-flop accusation is the single most damaging output this system
 * can produce, so the extractor's self-rated confidence has to clear a bar
 * before the badge appears. The card itself still exists below the bar - the
 * position change is real enough to store and show - it just does not get the
 * loudest label in the app attached to it.
 */
export const DEFAULT_FLIP_FLOP_CONFIDENCE = 0.7

/**
 * Above this similarity, two positions are the same position said twice.
 *
 * Reuses the verification ladder's Levenshtein ratio rather than a second
 * notion of "similar", so there is one definition of string closeness in the
 * codebase. Compared after normalization, so casing, punctuation, and filler
 * differences do not read as a change of position.
 */
export const SAME_POSITION_SIMILARITY = 0.9

export interface FlagOptions {
  /** Minimum extractor confidence for FLIP_FLOP. Default 0.7. */
  flipFlopConfidence?: number
  /** Above this, previous and current are treated as the same position. */
  samePositionSimilarity?: number
}

/**
 * Everything the rules need about one insight.
 *
 * Deliberately not `VerifiedItem`: the rules depend on a handful of facts,
 * some of which (prior history, fact-check status) are not properties of an
 * extracted item at all. Naming them explicitly keeps the test table honest
 * about what actually drives each branch.
 */
export interface FlagSubject {
  cardType: CardType
  payload: InsightPayload
  /** The card's headline claim: for a stance change, the current position. */
  headline: string
  /** The extractor's self-rated confidence, 0 to 1. */
  confidence: number
  /** null when the document names no speaker. */
  candidateName: string | null
  /**
   * Whether any insight already exists for this speaker and topic.
   *
   * Resolved by the caller against the database, and within a batch against
   * the rows the batch itself is about to write. See lib/queries/history.ts.
   */
  hasPriorHistory: boolean
  /** Where the claim stands with an external checker. See ./fact-check.ts. */
  factCheckStatus: FactCheckStatus
}

/**
 * Read the configurable threshold from the environment.
 *
 * The blank check is load-bearing: `Number("")` is 0, and an unset-but-present
 * env var silently becoming a threshold of 0 would flag every stance change in
 * the system as a flip-flop. Anything that is not a number in [0, 1] falls
 * back to the default rather than being coerced.
 */
export function flagOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): FlagOptions {
  const configured = env.FLIP_FLOP_CONFIDENCE_THRESHOLD?.trim()
  if (!configured) return { flipFlopConfidence: DEFAULT_FLIP_FLOP_CONFIDENCE }

  const raw = Number(configured)
  return {
    flipFlopConfidence:
      Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : DEFAULT_FLIP_FLOP_CONFIDENCE,
  }
}

/**
 * Symbols that carry meaning and would otherwise be stripped as punctuation.
 *
 * Without this, "cap rents at 3%" and "cap rents at 3 percent" normalize to
 * strings that differ by eight characters on a short input, which reads as a
 * change of position. That is the damaging direction to be wrong in, and a
 * percent sign versus the spelled-out word is the most common rewording there
 * is in policy text.
 */
const SYMBOL_WORDS: [RegExp, string][] = [
  [/%/g, " percent "],
  [/&/g, " and "],
  [/\+/g, " plus "],
]

/**
 * Strip everything that is not the substance of a position.
 *
 * Case, punctuation, and runs of whitespace are noise when asking whether a
 * person changed their mind. "We will cap rents." and "we will cap rents"
 * are the same position, and a comparison that says otherwise manufactures a
 * flip-flop out of a copy edit.
 *
 * This is a backstop, not the main guard. Numerals against spelled-out numbers
 * ("3" versus "three") still read as a difference here, and chasing every such
 * equivalence would be a natural-language problem rather than a string one.
 * The rule that actually keeps false flip-flops out is the confidence
 * threshold; this only stops the most mechanical false positives.
 */
function normalizePosition(text: string): string {
  let out = text.toLowerCase().replace(/[‘’“”]/g, "'")
  for (const [pattern, word] of SYMBOL_WORDS) out = out.replace(pattern, word)

  return out
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Are these two positions substantively different?
 *
 * Exported because it is the judgment call inside FLIP_FLOP and deserves its
 * own tests. Returns false - not different - whenever it cannot tell, which
 * is the safe direction: a missing previous position is a reason to withhold
 * the badge, never a reason to award it.
 */
export function positionsDiffer(
  previous: string | null | undefined,
  current: string | null | undefined,
  threshold = SAME_POSITION_SIMILARITY,
): boolean {
  const before = normalizePosition(previous ?? "")
  const after = normalizePosition(current ?? "")

  if (!before || !after) return false
  if (before === after) return false

  return similarity(before, after) < threshold
}

/**
 * The badges this insight carries.
 *
 * Returned in a stable order - the order of INSIGHT_FLAGS - so that two rows
 * with the same badges compare equal as arrays, and so `flags[0]` is a
 * predictable value for the legacy single-flag column to mirror.
 *
 * An insight can carry several at once. A first-ever stance change on a topic
 * is both NEW and FLIP_FLOP, and showing only one of those would be a worse
 * card than showing both.
 */
export function assignFlags(
  subject: FlagSubject,
  options: FlagOptions = {},
): InsightFlag[] {
  const flags: InsightFlag[] = []

  if (isNew(subject)) flags.push("NEW")
  if (isFlipFlop(subject, options)) flags.push("FLIP_FLOP")
  if (isUnverifiedClaim(subject)) flags.push("UNVERIFIED_CLAIM")

  return flags
}

/**
 * NEW: the first thing on record for this speaker on this topic.
 *
 * Requires a named speaker. "Speaker + topic" is not a pair an unattributed
 * claim has, and treating every unattributed insight as one anonymous speaker
 * would mean the first unattributed card in the whole database is NEW and no
 * later one ever is. Unattributed cards simply do not carry this badge.
 */
function isNew(subject: FlagSubject): boolean {
  if (!subject.candidateName) return false
  return !subject.hasPriorHistory
}

/**
 * FLIP_FLOP: a recorded change of position, above the confidence bar.
 *
 * Three conditions, all required:
 *   - the pipeline produced a stance_change card, which itself is only
 *     possible when prior stance records were supplied to the extractor;
 *   - the previous and current positions are substantively different rather
 *     than reworded;
 *   - the extractor's confidence clears the threshold.
 *
 * The first condition is doing quiet work: the model cannot decide to call
 * something a flip-flop, because the badge is derived from a card type that
 * only exists when there was documented history to compare against.
 */
function isFlipFlop(subject: FlagSubject, options: FlagOptions): boolean {
  if (subject.payload.cardType !== "stance_change") return false

  const threshold = options.flipFlopConfidence ?? DEFAULT_FLIP_FLOP_CONFIDENCE
  if (!(subject.confidence >= threshold)) return false

  return positionsDiffer(
    subject.payload.previousPosition,
    subject.headline,
    options.samePositionSimilarity ?? SAME_POSITION_SIMILARITY,
  )
}

/**
 * UNVERIFIED_CLAIM: a factual assertion a reader should not take on trust.
 *
 * Either the claim is not the kind of thing that can be settled quickly, or
 * nothing has actually settled it yet. With no fact-check provider wired up
 * the second condition is always true, so every factual claim carries the
 * badge - which is the honest state of the system today.
 *
 * Note what a resolved verdict does: a claim checked and found false loses
 * this badge, because it is no longer unverified. Saying so needs its own
 * badge, which is a deliberate gap rather than an oversight.
 */
function isUnverifiedClaim(subject: FlagSubject): boolean {
  if (subject.payload.cardType !== "factual_claim") return false

  if (subject.payload.checkability !== "easily_checkable") return true
  return subject.factCheckStatus === "unresolved"
}

/**
 * The value for the legacy single-flag column.
 *
 * The first version of the UI reads one badge. Mirroring flags[0] keeps that
 * card component working unchanged while new code reads the array.
 */
export function primaryFlag(flags: readonly InsightFlag[]): InsightFlag | null {
  return flags[0] ?? null
}
