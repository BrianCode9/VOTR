/**
 * Rung 4 of the verification ladder: approximate quote location.
 *
 * Split out of verify.ts because it is the one part of verification that is
 * allowed to be wrong. Rungs 1 to 3 are lossless - they undo a transformation
 * that provably happened to the text - while this rung accepts that the model
 * wrote something slightly different from the document and finds the closest
 * real span. Everything it returns is flagged `fuzzy` downstream and shown as
 * a corrected quote, never as an exact one.
 *
 * It returns offsets into the ORIGINAL text, via the caller's index map. That
 * is the same non-negotiable property the rest of the ladder holds.
 */

/**
 * A normalized string plus, for each of its characters, the span in the
 * original string that produced it. Built by verify.ts.
 */
export interface MappedText {
  text: string
  starts: number[]
  ends: number[]
}

/**
 * Below this many characters a fuzzy match is not evidence of anything.
 *
 * At a 0.9 threshold a ten character needle may differ by one character, which
 * is enough to turn "will not" into "will now". Short quotes must match
 * losslessly or fail; there is no useful middle ground.
 */
export const MIN_FUZZY_QUOTE_CHARS = 24

/** An anchor shorter than this appears everywhere and anchors nothing. */
const MIN_ANCHOR_CHARS = 5

/** Caps on the search, so a pathological document cannot stall the pipeline. */
const MAX_ANCHORS = 4
const MAX_OCCURRENCES_PER_ANCHOR = 20
const MAX_WINDOWS = 240

interface Token {
  text: string
  start: number
  end: number
}

/** Anything that is not a letter or a digit can begin or end a quote. */
const PUNCTUATION = /[^\p{L}\p{N}]/u

/** Split normalized text on its single spaces. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] === " ") {
      i++
      continue
    }
    let j = i
    while (j < text.length && text[j] !== " ") j++
    tokens.push({ text: text.slice(i, j), start: i, end: j })
    i = j
  }
  return tokens
}

/**
 * Similarity as 1 - (edit distance / longer length).
 *
 * Reported on every fuzzy match and stored, so a reviewer can see how far the
 * model's string was from the text it matched rather than taking "verified" on
 * faith.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const longer = Math.max(a.length, b.length)
  const distance = boundedLevenshtein(a, b, longer)
  return 1 - distance / longer
}

/**
 * Levenshtein distance, abandoned as soon as it provably exceeds maxDistance.
 *
 * The abort matters: the fuzzy rung scores a few hundred windows and all but
 * one of them are wrong by a wide margin, so the common case is a row minimum
 * blowing past the budget within the first few characters.
 */
export function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1
  if (!a.length) return b.length
  if (!b.length) return a.length

  let previous = new Array<number>(b.length + 1)
  let current = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) previous[j] = j

  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    let rowMin = current[0]
    const ai = a[i - 1]

    for (let j = 1; j <= b.length; j++) {
      const cost = ai === b[j - 1] ? 0 : 1
      const value = Math.min(
        previous[j] + 1, // deletion
        current[j - 1] + 1, // insertion
        previous[j - 1] + cost, // substitution
      )
      current[j] = value
      if (value < rowMin) rowMin = value
    }

    if (rowMin > maxDistance) return maxDistance + 1
    const swap = previous
    previous = current
    current = swap
  }

  return previous[b.length]
}

export interface WindowScore {
  /** 1 - distance/longer, the number the threshold is checked against. */
  ratio: number
  /**
   * Characters accounted for: longer - distance.
   *
   * This, not the ratio, is what candidate windows are ranked by. Dropping a
   * word out of the middle of a quote makes a TRUNCATED window score a better
   * ratio than the full one - "…at three percent next" beats "…at three
   * percent next year" when the model wrote "…at three percent year" - and
   * ranking by ratio would therefore store a span that stops mid-sentence.
   * Ranking by matched characters prefers the fullest span that still clears
   * the bar, which is the one a reader would have highlighted.
   */
  matched: number
}

/** Score a window, or null as soon as it cannot reach `threshold`. */
export function scoreWindow(
  a: string,
  b: string,
  threshold: number,
): WindowScore | null {
  const longer = Math.max(a.length, b.length)
  if (longer === 0) return null
  const budget = Math.floor((1 - threshold) * longer)
  const distance = boundedLevenshtein(a, b, budget)
  if (distance > budget) return null
  return { ratio: 1 - distance / longer, matched: longer - distance }
}

/** Similarity, or null as soon as it cannot reach `threshold`. */
export function similarityAtLeast(
  a: string,
  b: string,
  threshold: number,
): number | null {
  return scoreWindow(a, b, threshold)?.ratio ?? null
}

/**
 * Find the best approximate location of `needle` in `haystack`, returning
 * offsets into the ORIGINAL text via the haystack's index map.
 *
 * The search is anchored rather than exhaustive. Sliding a window over every
 * character of a long article and running an edit distance at each position is
 * both slow and needless: a quote that is 90% right shares at least one long
 * word with its source, so only windows near an occurrence of one of the
 * needle's longest words are worth scoring.
 */
export function locateFuzzy(
  haystack: MappedText,
  needle: string,
  threshold: number,
): { start: number; end: number; score: number } | null {
  if (needle.length < MIN_FUZZY_QUOTE_CHARS) return null
  if (!haystack.text.length) return null

  const hayLower = haystack.text.toLowerCase()
  const needleLower = needle.toLowerCase()

  const anchors = tokenize(needleLower)
    .filter((t) => t.text.length >= MIN_ANCHOR_CHARS)
    .sort((x, y) => y.text.length - x.text.length)
    .slice(0, MAX_ANCHORS)

  // Nothing distinctive to anchor on. Refusing here is correct: a quote made
  // entirely of short common words is exactly the one that fuzzy-matches
  // somewhere it does not belong.
  if (anchors.length === 0) return null

  const wordStarts = new Set<number>()
  const wordEnds = new Set<number>()
  for (const token of tokenize(hayLower)) {
    wordStarts.add(token.start)
    wordEnds.add(token.end)

    // Also offer boundaries inside a token's leading and trailing punctuation.
    //
    // Without these the only candidate end after `hearing,` is the one AFTER
    // the comma, so a model quote that stops at "hearing" either drags the
    // comma in or misses the threshold. A reader highlighting that sentence
    // would stop at the word, so the matcher has to be able to as well.
    let from = token.start
    while (from < token.end && PUNCTUATION.test(hayLower[from])) {
      from++
      wordStarts.add(from)
    }
    let to = token.end
    while (to > token.start && PUNCTUATION.test(hayLower[to - 1])) {
      to--
      wordEnds.add(to)
    }
  }
  const startBoundaries = [...wordStarts].sort((x, y) => x - y)
  const endBoundaries = [...wordEnds].sort((x, y) => x - y)

  const L = needle.length
  const lengths = [Math.round(L * 0.88), L, Math.round(L * 1.12)]

  interface Candidate {
    start: number
    end: number
    ratio: number
    matched: number
  }

  /** More matched characters wins; the ratio only breaks ties. */
  const better = (a: Candidate, b: Candidate | null): boolean =>
    !b || a.matched > b.matched || (a.matched === b.matched && a.ratio > b.ratio)

  let best: Candidate | null = null
  let windows = 0
  const seen = new Set<string>()

  const consider = (from: number, to: number) => {
    if (from < 0 || to > haystack.text.length) return
    if (to - from < MIN_FUZZY_QUOTE_CHARS) return
    const key = `${from}:${to}`
    if (seen.has(key)) return
    seen.add(key)
    windows++

    const score = scoreWindow(hayLower.slice(from, to), needleLower, threshold)
    if (!score) return
    const candidate: Candidate = { start: from, end: to, ...score }
    if (better(candidate, best)) best = candidate
  }

  outer: for (const anchor of anchors) {
    let from = 0
    for (let n = 0; n < MAX_OCCURRENCES_PER_ANCHOR; n++) {
      const hit = hayLower.indexOf(anchor.text, from)
      if (hit === -1) break
      from = hit + anchor.text.length

      // Line the anchor up where it sits inside the needle, then let the
      // window start snap to a real word boundary near that estimate.
      const estimate = hit - anchor.start
      for (const start of nearest(startBoundaries, estimate, 2)) {
        for (const length of lengths) {
          for (const end of nearest(endBoundaries, start + length, 2)) {
            consider(start, end)
            if (windows > MAX_WINDOWS) break outer
          }
        }
      }
    }
  }

  if (best === null) return null

  // Greedy boundary refinement: nudge each edge to the neighbouring word
  // boundaries and keep any move that scores better. This is what turns a
  // window that happens to swallow half of the next sentence into the span a
  // reader would have highlighted.
  let refined: Candidate = best
  for (let pass = 0; pass < 3; pass++) {
    const before = refined.matched

    for (const start of nearest(startBoundaries, refined.start, 3)) {
      if (start >= refined.end) continue
      const score = scoreWindow(hayLower.slice(start, refined.end), needleLower, threshold)
      if (!score) continue
      const candidate: Candidate = { start, end: refined.end, ...score }
      if (better(candidate, refined)) refined = candidate
    }

    for (const end of nearest(endBoundaries, refined.end, 3)) {
      if (end <= refined.start) continue
      const score = scoreWindow(hayLower.slice(refined.start, end), needleLower, threshold)
      if (!score) continue
      const candidate: Candidate = { start: refined.start, end, ...score }
      if (better(candidate, refined)) refined = candidate
    }

    if (refined.matched <= before) break
  }

  if (refined.ratio < threshold) return null

  return {
    start: haystack.starts[refined.start],
    // The exclusive end of the LAST matched character's original span.
    end: haystack.ends[refined.end - 1],
    score: refined.ratio,
  }
}

/** The boundaries closest to `target`, up to `count` on each side. */
function nearest(boundaries: number[], target: number, count: number): number[] {
  if (boundaries.length === 0) return []

  // Binary search for the first boundary at or after target.
  let lo = 0
  let hi = boundaries.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (boundaries[mid] < target) lo = mid + 1
    else hi = mid
  }

  const out: number[] = []
  for (let i = lo - count; i <= lo + count; i++) {
    if (i >= 0 && i < boundaries.length) out.push(boundaries[i])
  }
  return out
    .sort((x, y) => Math.abs(x - target) - Math.abs(y - target))
    .slice(0, count * 2)
}
