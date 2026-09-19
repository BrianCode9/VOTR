import type { Document } from "../adapters/types"
import { NAMED_ENTITIES } from "../adapters/html-to-text"

/**
 * The quote verification ladder.
 *
 * Nothing renders in the UI unless it passes through here. The offsets this
 * returns index into the ORIGINAL document.rawText, never into any normalized
 * copy, because the frontend highlights by slicing the stored document.
 *
 * The whole difficulty is that rungs 2 and 3 match against text whose length
 * differs from the original: `&amp;` is five characters that become one, a
 * whitespace run collapses, filler words disappear entirely. A match position
 * in normalized space is therefore not a position in the original. Normalizing
 * and then using the normalized index is the bug this module exists to make
 * impossible, and it is the bug that passes a naive test.
 *
 * The fix is to build an index map during normalization, so every normalized
 * character remembers the span of original characters that produced it.
 */

export type VerifyRung = "exact" | "normalized" | "transcript"

export type VerifyResult =
  | {
      ok: true
      /** Inclusive start offset into document.rawText. */
      start: number
      /** Exclusive end offset into document.rawText. */
      end: number
      /** Which rung matched. Useful signal for the judge stage. */
      rung: VerifyRung
      /** How many times the quote appears. >1 means the span is ambiguous. */
      occurrences: number
    }
  | { ok: false; reason: string }

/**
 * A normalized string plus, for each of its characters, the span in the
 * ORIGINAL string that produced it.
 *
 * starts[i] and ends[i] are offsets into the original. ends is exclusive.
 * Keeping ends separately from starts is what makes a quote that ends on a
 * multi-character source construct (an entity, a collapsed whitespace run)
 * resolve to the right closing boundary. Using starts[i + 1] instead would
 * truncate or overrun, which is precisely the failure mode that renders
 * garbage in the UI.
 *
 * Arrays are indexed per UTF-16 code unit so that text.length, starts.length
 * and ends.length always agree.
 */
interface Mapped {
  text: string
  starts: number[]
  ends: number[]
}

/* -------------------------------------------------------------- public -- */

export function verifyQuote(quote: string, doc: Document): VerifyResult {
  const raw = doc.rawText
  const candidate = quote.trim()

  if (!candidate) return { ok: false, reason: "quote is empty" }
  if (!raw) return { ok: false, reason: "document has no raw text" }

  // Rung 1: exact substring. Offsets come straight from the match, no mapping.
  const exactIdx = raw.indexOf(candidate)
  if (exactIdx !== -1) {
    return {
      ok: true,
      start: exactIdx,
      end: exactIdx + candidate.length,
      rung: "exact",
      occurrences: countOccurrences(raw, candidate),
    }
  }

  // Rung 2: normalized. Whitespace, quote characters, dashes, HTML entities.
  const docNorm = normalizeMapped(raw)
  const quoteNorm = normalizeMapped(candidate).text.trim()

  const normHit = locate(docNorm, quoteNorm)
  if (normHit) {
    if (!verifiesBack(raw, normHit.start, normHit.end, quoteNorm, "normalized")) {
      return { ok: false, reason: "offset mapping failed self-check at rung 2" }
    }
    return { ok: true, ...normHit, rung: "normalized" }
  }

  // Rung 3: transcripts only. Filler words and stutter repeats.
  if (doc.mediaType === "transcript") {
    const docSpeech = stripSpeech(docNorm)
    const quoteSpeech = stripSpeech(normalizeMapped(candidate)).text.trim()

    const speechHit = locate(docSpeech, quoteSpeech)
    if (speechHit) {
      if (
        !verifiesBack(raw, speechHit.start, speechHit.end, quoteSpeech, "transcript")
      ) {
        return { ok: false, reason: "offset mapping failed self-check at rung 3" }
      }
      return { ok: true, ...speechHit, rung: "transcript" }
    }
  }

  return {
    ok: false,
    reason: `quote not found in document (${candidate.length} chars, tried ${
      doc.mediaType === "transcript" ? "3 rungs" : "2 rungs"
    })`,
  }
}

/**
 * Re-derive the normalized form from the ORIGINAL slice the offsets point at
 * and confirm it reproduces what we matched.
 *
 * This turns "the index mapping is correct" from a property the tests assert
 * into a property the function refuses to violate at runtime. If a future edit
 * to the normalizer breaks the mapping, verification starts failing closed
 * instead of quietly emitting offsets that render the wrong span.
 */
function verifiesBack(
  raw: string,
  start: number,
  end: number,
  expected: string,
  rung: VerifyRung,
): boolean {
  if (start < 0 || end > raw.length || start >= end) return false
  const slice = raw.slice(start, end)
  const renormalized =
    rung === "transcript"
      ? stripSpeech(normalizeMapped(slice)).text.trim()
      : normalizeMapped(slice).text.trim()
  return renormalized === expected
}

function locate(
  haystack: Mapped,
  needle: string,
): { start: number; end: number; occurrences: number } | null {
  if (!needle) return null
  const idx = haystack.text.indexOf(needle)
  if (idx === -1) return null
  return {
    start: haystack.starts[idx],
    // The exclusive end of the LAST matched character's original span.
    end: haystack.ends[idx + needle.length - 1],
    occurrences: countOccurrences(haystack.text, needle),
  }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let from = 0
  for (;;) {
    const i = haystack.indexOf(needle, from)
    if (i === -1) return count
    count++
    from = i + needle.length
  }
}

/* --------------------------------------------------------- normalizing -- */

/** Rung 2 normalization: entities, then whitespace and character folding. */
function normalizeMapped(input: string): Mapped {
  return foldCharacters(decodeEntities(input))
}

const ENTITY_RE = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/y

function decodeEntities(input: string): Mapped {
  const chars: string[] = []
  const starts: number[] = []
  const ends: number[] = []

  let i = 0
  while (i < input.length) {
    if (input[i] === "&") {
      ENTITY_RE.lastIndex = i
      const m = ENTITY_RE.exec(input)
      if (m) {
        const decoded = decodeEntityBody(m[1])
        if (decoded !== null) {
          // Every character the entity decodes to maps to the whole entity.
          for (let k = 0; k < decoded.length; k++) {
            chars.push(decoded[k])
            starts.push(i)
            ends.push(i + m[0].length)
          }
          i += m[0].length
          continue
        }
      }
    }
    chars.push(input[i])
    starts.push(i)
    ends.push(i + 1)
    i++
  }

  return { text: chars.join(""), starts, ends }
}

function decodeEntityBody(body: string): string | null {
  if (body[0] === "#") {
    const code =
      body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null
    try {
      return String.fromCodePoint(code)
    } catch {
      return null
    }
  }
  return NAMED_ENTITIES[body.toLowerCase()] ?? null
}

/** Characters that models routinely swap for their plain equivalents. */
const FOLD: Record<string, string> = {
  "“": '"', // left double
  "”": '"', // right double
  "„": '"',
  "‟": '"',
  "″": '"',
  "«": '"',
  "»": '"',
  "‘": "'", // left single
  "’": "'", // right single, also the apostrophe models normalize
  "‚": "'",
  "‛": "'",
  "′": "'",
  "–": "-", // en dash
  "—": "-", // em dash
  "‒": "-",
  "―": "-",
  "−": "-", // minus sign
  "…": "...", // ellipsis, one source char becomes three
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || /\s/.test(ch)
}

function foldCharacters(a: Mapped): Mapped {
  const chars: string[] = []
  const starts: number[] = []
  const ends: number[] = []

  let i = 0
  while (i < a.text.length) {
    const ch = a.text[i]

    if (isSpace(ch)) {
      // A whole run of whitespace collapses to one space that spans the run.
      let j = i
      while (j < a.text.length && isSpace(a.text[j])) j++
      chars.push(" ")
      starts.push(a.starts[i])
      ends.push(a.ends[j - 1])
      i = j
      continue
    }

    const replacement = FOLD[ch] ?? ch
    for (let k = 0; k < replacement.length; k++) {
      chars.push(replacement[k])
      starts.push(a.starts[i])
      ends.push(a.ends[i])
    }
    i++
  }

  return { text: chars.join(""), starts, ends }
}

/* ------------------------------------------------------------ rung 3 ---- */

/**
 * Spoken-language noise. Deliberately conservative: every word here is one a
 * transcriber emits and a speaker does not mean. Words like "like" and "so"
 * are excluded because they carry meaning often enough that stripping them
 * could make a quote match text the speaker did not say.
 */
const FILLER = new Set([
  "um",
  "uh",
  "uhm",
  "erm",
  "er",
  "ah",
  "hmm",
  "mm",
  "mhm",
])

/**
 * Rung 3, transcripts only: drop filler and collapse immediate word repeats.
 *
 * Runs on an already-normalized Mapped and composes through its index map, so
 * offsets still land in the original rawText.
 */
function stripSpeech(b: Mapped): Mapped {
  const tokens: { text: string; start: number; end: number }[] = []

  let i = 0
  while (i < b.text.length) {
    if (b.text[i] === " ") {
      i++
      continue
    }
    let j = i
    while (j < b.text.length && b.text[j] !== " ") j++
    tokens.push({ text: b.text.slice(i, j), start: i, end: j })
    i = j
  }

  const kept: typeof tokens = []
  let previousBare = ""
  for (const token of tokens) {
    const bare = token.text.replace(/[^\p{L}\p{N}']/gu, "").toLowerCase()
    if (bare && FILLER.has(bare)) continue
    // "the the bill" is a stutter; collapse to the first occurrence.
    if (bare && bare === previousBare) continue
    kept.push(token)
    if (bare) previousBare = bare
  }

  const chars: string[] = []
  const starts: number[] = []
  const ends: number[] = []

  kept.forEach((token, index) => {
    if (index > 0) {
      // The joining space spans whatever sat between the two kept tokens,
      // including any filler that was removed.
      const previous = kept[index - 1]
      const spaceStart = b.ends[previous.end - 1]
      const spaceEnd = b.starts[token.start]
      chars.push(" ")
      starts.push(spaceStart)
      ends.push(Math.max(spaceStart, spaceEnd))
    }
    for (let k = token.start; k < token.end; k++) {
      chars.push(b.text[k])
      starts.push(b.starts[k])
      ends.push(b.ends[k])
    }
  })

  return { text: chars.join(""), starts, ends }
}
