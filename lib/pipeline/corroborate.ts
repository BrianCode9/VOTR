import { similarity } from "../extract/fuzzy"
import { normalizeSpeakerName } from "../speakers/normalize"
import type { CardType } from "../schemas/insight"

/**
 * Source diversity: is this one outlet's reading, or three?
 *
 * The question this module answers is narrow. Two insights corroborate when
 * they are the same speaker on the same topic saying substantively the same
 * thing, reported by DIFFERENT sources. Everything else - reprints of the same
 * wire copy, two articles from one outlet, the same claim about two people -
 * is not corroboration and must not raise the count, because the count is the
 * number a reader will use to decide how much to trust a card.
 *
 * Split from lib/pipeline/dedup.ts on purpose. Dedup asks "are these the same
 * row?" within one document and collapses the loser. This asks "are these
 * independent reports of the same thing?" across documents and keeps both:
 * the second report is the evidence, so discarding it would destroy the
 * signal being counted.
 *
 * Pure, and deliberately so. The database work lives in
 * lib/storage/corroboration.ts; the judgment lives here where it is testable
 * against literals.
 */

export interface CorroborationThresholds {
  /**
   * Levenshtein ratio above which two normalized claim texts are the same
   * claim. Lower than the 0.9 that lib/flags/assign.ts uses for "same
   * position", because that comparison sees one speaker's own words twice
   * while this one sees two newsrooms paraphrasing the same sentence.
   */
  textSimilarity: number
  /**
   * Dice coefficient over content words, above which two claims are the same
   * claim regardless of edit distance.
   *
   * Carries most of the real matches. "Backs a three percent cap on rent
   * increases" and "Supports capping rent increases at 3%" are far apart by
   * edit distance and share nearly every content word, which is the shape
   * independent coverage of one position actually takes.
   */
  tokenOverlap: number
  /** Below this many content words, only the text rule applies. */
  minTokens: number
}

export const DEFAULT_CORROBORATION_THRESHOLDS: CorroborationThresholds = {
  textSimilarity: 0.82,
  tokenOverlap: 0.6,
  minTokens: 3,
}

export function corroborationThresholdsFromEnv(
  env: Record<string, string | undefined> = process.env,
): CorroborationThresholds {
  return {
    textSimilarity: ratio(
      env.CORROBORATION_TEXT_SIMILARITY,
      DEFAULT_CORROBORATION_THRESHOLDS.textSimilarity,
    ),
    tokenOverlap: ratio(
      env.CORROBORATION_TOKEN_OVERLAP,
      DEFAULT_CORROBORATION_THRESHOLDS.tokenOverlap,
    ),
    minTokens: DEFAULT_CORROBORATION_THRESHOLDS.minTokens,
  }
}

function ratio(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim()
  if (!trimmed) return fallback
  const value = Number(trimmed)
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback
}

/**
 * The identity of an outlet, for the "different source" test.
 *
 * Normalized from `documents.source_name` rather than from the document id,
 * because the rule is that two articles from one outlet count once. The host
 * is used when a source name is all but absent, so `www.npr.org` and
 * `text.npr.org` still land in one bucket.
 */
export function sourceKey(sourceName: string, url?: string | null): string {
  const name = sourceName
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/^(the|a)\s+/, "")
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (name) return name

  // A document with no usable source name still has to land in some bucket,
  // and the host is the honest one. Falling back to the document id would make
  // every such document its own "independent" source, which is the exact
  // inflation this count must not have.
  if (url) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^(www|amp|text|m)\./, "")
    } catch {
      /* not a URL; fall through */
    }
  }

  return "unknown source"
}

/**
 * Which card kinds can corroborate each other.
 *
 * A stance and a stance change about the same position are two outlets
 * reporting the same current position, which is exactly corroboration. A
 * factual claim and a stance are not: one is what a person believes and the
 * other is an assertion about the world, and conflating them would let a claim
 * about housing starts "corroborate" a housing position.
 */
const CORROBORATION_CLASS: Record<CardType, string> = {
  stance: "position",
  stance_change: "position",
  factual_claim: "claim",
  voter_relevance: "impact",
}

export function corroborationClass(cardType: CardType): string {
  return CORROBORATION_CLASS[cardType]
}

/** The minimum an insight has to expose for this module to judge it. */
export interface CorroborationSubject {
  id: string
  cardType: CardType
  /** Primary issue tag. Secondary tags deliberately do not widen the match. */
  topic: string
  /**
   * Preferred identity for the speaker. A speaker id when one is resolved,
   * otherwise the raw name, which is normalized here.
   */
  speakerId: string | null
  speakerName: string | null
  /** The card's headline claim: the position, the claim text, the risk. */
  headline: string
  /** Normalized outlet identity. See sourceKey. */
  sourceKey: string
  documentId: string
}

export interface CorroborationVerdict {
  corroborates: boolean
  /** How the two matched, or why they did not. Stored on the link row. */
  reason: string
  /** The stronger of the two measures, 0 when they did not match. */
  score: number
}

/**
 * Words that carry no topic signal and would inflate the overlap measure.
 *
 * Short and English-only on purpose. A long stoplist starts deleting policy
 * vocabulary ("state", "work", "care"), and the cost of a missed match here is
 * a count of 2 where 3 was right, while the cost of a wrong match is a card
 * claiming independent corroboration it does not have.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from",
  "had", "has", "have", "he", "her", "his", "in", "is", "it", "its", "of", "on",
  "or", "she", "that", "the", "their", "them", "they", "this", "to", "was",
  "were", "will", "with", "would", "says", "said", "say",
])

/** Spelled-out equivalents, so "3 percent" and "three percent" share a token. */
const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
}

/**
 * Reduce a claim to its content words.
 *
 * Numerals and their spelled-out forms collapse together, a plural s is
 * dropped, and stopwords go. This is the only place in the codebase that does
 * stemming, and it stays this crude deliberately: the token measure is one of
 * two rules, not the whole judgment.
 */
export function contentTokens(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/%/g, " percent ")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()

  const out: string[] = []
  for (const raw of normalized.split(" ")) {
    if (!raw) continue
    const word = NUMBER_WORDS[raw] ?? raw
    if (STOPWORDS.has(word)) continue
    // Crude plural stripping. "increases" and "increase" are the same word for
    // this purpose, and a bare "s" is not a word.
    const stem =
      word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
        ? word.slice(0, -1)
        : word
    if (!out.includes(stem)) out.push(stem)
  }
  return out
}

/** Dice coefficient over the two token sets. 1 when identical, 0 when disjoint. */
export function tokenOverlap(a: string, b: string): number {
  const left = contentTokens(a)
  const right = contentTokens(b)
  if (left.length === 0 || right.length === 0) return 0

  const rightSet = new Set(right)
  let shared = 0
  for (const token of left) if (rightSet.has(token)) shared++

  return (2 * shared) / (left.length + right.length)
}

/** Normalized text for the edit-distance rule. */
function normalizeClaim(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/%/g, " percent ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Do two subjects describe the same person? Id first, name as the fallback. */
export function sameSpeaker(a: CorroborationSubject, b: CorroborationSubject): boolean {
  if (a.speakerId && b.speakerId) return a.speakerId === b.speakerId
  if (!a.speakerName || !b.speakerName) return false

  const left = normalizeSpeakerName(a.speakerName)
  const right = normalizeSpeakerName(b.speakerName)
  return left.length > 0 && left === right
}

/**
 * The judgment: do these two insights corroborate each other?
 *
 * Every gate is a hard requirement and they are checked cheapest first. The
 * reason string is kept on the link row so a surprising count of 4 can be
 * explained without re-running the matcher.
 */
export function claimsCorroborate(
  a: CorroborationSubject,
  b: CorroborationSubject,
  thresholds: CorroborationThresholds = DEFAULT_CORROBORATION_THRESHOLDS,
): CorroborationVerdict {
  if (a.id === b.id) return no("same insight")

  // The whole point of the count. Two articles from one outlet are one outlet,
  // and a document compared against itself is not evidence of anything.
  if (a.sourceKey === b.sourceKey) return no(`same source: ${a.sourceKey}`)
  if (a.documentId === b.documentId) return no("same document")

  if (corroborationClass(a.cardType) !== corroborationClass(b.cardType)) {
    return no(`different kinds of claim: ${a.cardType} vs ${b.cardType}`)
  }

  if (a.topic !== b.topic) return no(`different topics: ${a.topic} vs ${b.topic}`)

  // An unattributed claim has no speaker to agree about. Counting two of them
  // as corroborating would make every anonymous claim on a topic corroborate
  // every other one.
  if (!sameSpeaker(a, b)) return no("different or unidentified speaker")

  const text = similarity(normalizeClaim(a.headline), normalizeClaim(b.headline))
  if (text >= thresholds.textSimilarity) {
    return { corroborates: true, reason: `text similarity ${text.toFixed(3)}`, score: text }
  }

  const tokensA = contentTokens(a.headline)
  const tokensB = contentTokens(b.headline)
  if (tokensA.length < thresholds.minTokens || tokensB.length < thresholds.minTokens) {
    return no(`too few content words to compare (${tokensA.length}, ${tokensB.length})`)
  }

  const overlap = tokenOverlap(a.headline, b.headline)
  if (overlap >= thresholds.tokenOverlap) {
    return { corroborates: true, reason: `token overlap ${overlap.toFixed(3)}`, score: overlap }
  }

  return {
    corroborates: false,
    reason: `not similar enough: text ${text.toFixed(3)}, overlap ${overlap.toFixed(3)}`,
    score: 0,
  }
}

function no(reason: string): CorroborationVerdict {
  return { corroborates: false, reason, score: 0 }
}

/**
 * The distinct source keys behind an insight, the subject's own first.
 *
 * This is what `insights.corroborating_source_ids` stores, and the ordering is
 * part of the contract: a client rendering "NPR and 2 others" reads the first
 * entry as the card's own outlet.
 */
export function distinctSourceKeys(
  subject: Pick<CorroborationSubject, "sourceKey">,
  matches: readonly Pick<CorroborationSubject, "sourceKey">[],
): string[] {
  const out = [subject.sourceKey]
  for (const match of matches) {
    if (!out.includes(match.sourceKey)) out.push(match.sourceKey)
  }
  return out
}

/**
 * The stored count, from a subject and everything that corroborates it.
 *
 * Counts DISTINCT sources and includes the subject's own, so the number means
 * "how many independent outlets reported this", and 1 is the honest floor for
 * an insight nothing else has confirmed. A count that excluded the subject
 * would make 0 and 1 both mean "one outlet", and every reader of the field
 * would have to know which.
 */
export function countDistinctSources(
  subject: Pick<CorroborationSubject, "sourceKey">,
  matches: readonly Pick<CorroborationSubject, "sourceKey">[],
): number {
  return distinctSourceKeys(subject, matches).length
}

/**
 * Every corroborating pair within a set, judged once per unordered pair.
 *
 * Quadratic and fine at that: the caller only ever hands it the insights that
 * already share a speaker and a topic, which is a handful, never the table.
 */
export interface CorroborationPair {
  a: CorroborationSubject
  b: CorroborationSubject
  verdict: CorroborationVerdict
}

export function findCorroborations(
  subjects: readonly CorroborationSubject[],
  thresholds: CorroborationThresholds = DEFAULT_CORROBORATION_THRESHOLDS,
): CorroborationPair[] {
  const out: CorroborationPair[] = []

  for (let i = 0; i < subjects.length; i++) {
    for (let j = i + 1; j < subjects.length; j++) {
      const verdict = claimsCorroborate(subjects[i], subjects[j], thresholds)
      if (verdict.corroborates) out.push({ a: subjects[i], b: subjects[j], verdict })
    }
  }

  return out
}
