/**
 * Speaker identity, as string rules.
 *
 * `candidates` is scoped to a race, which makes it the wrong key for stance
 * history: the same person running in two races, or named two ways by two
 * outlets, becomes two rows, and a timeline grouped by candidate silently
 * splits a person's record in half. `speakers` is the person; `candidates` is
 * that person's appearance on one ballot line.
 *
 * Everything here is pure so that resolution can be tested without a database
 * and so the same normalization runs at write time (building the alias list)
 * and at read time (matching an incoming name against it).
 */

/**
 * Titles an outlet may or may not prepend. Stripped for matching only.
 *
 * The stored display name keeps whatever the document said; only the
 * normalized form loses the title, so "Rep. Jane Doe" and "Jane Doe" resolve
 * to one person while the card still renders the name its source used.
 */
const TITLES = [
  "rep",
  "representative",
  "sen",
  "senator",
  "gov",
  "governor",
  "mayor",
  "councilmember",
  "council member",
  "councilwoman",
  "councilman",
  "president",
  "vice president",
  "secretary",
  "attorney general",
  "judge",
  "justice",
  "dr",
  "mr",
  "mrs",
  "ms",
  "mx",
  "congressman",
  "congresswoman",
  "delegate",
  "commissioner",
  "state rep",
  "state sen",
  "assemblymember",
]

/** Suffixes that are part of a legal name but never distinguish two people here. */
const SUFFIXES = ["jr", "sr", "ii", "iii", "iv", "phd", "md", "esq"]

/**
 * A name reduced to the part that identifies a person.
 *
 * Lowercased, stripped of punctuation, titles, and suffixes, with whitespace
 * collapsed. Returns an empty string for anything that is left with nothing,
 * which callers treat as "not a usable name" rather than as a match-all.
 */
export function normalizeSpeakerName(raw: string): string {
  let text = raw
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    // Keep the apostrophe: O'Brien and OBrien are the same person, and the
    // dot after a title is removed below, so nothing else needs punctuation.
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()

  // Titles come off the front, repeatedly: "state rep. dr. jane doe" is one
  // person with two of them.
  let changed = true
  while (changed) {
    changed = false
    for (const title of TITLES) {
      if (text.startsWith(`${title} `)) {
        text = text.slice(title.length + 1)
        changed = true
      }
    }
  }

  // A title with nothing after it is not a person. Returning "mayor" here
  // would let a document that says only "the Mayor" mint a speaker row, and
  // every later unattributed "Mayor" would then resolve to that same fiction.
  if (TITLES.includes(text)) return ""

  const parts = text.split(" ").filter(Boolean)
  while (parts.length > 1 && SUFFIXES.includes(parts[parts.length - 1].replace(/'/g, ""))) {
    parts.pop()
  }

  return parts.join(" ").trim()
}

/**
 * Do these two names denote the same person?
 *
 * Exact normalized equality, plus one asymmetric rule: a two-token name whose
 * first and last both appear, in order, inside a longer normalized name is the
 * same person. That covers "Jane Doe" against "Jane Ann Doe" and nothing
 * looser. Deliberately NOT a fuzzy string distance: "Jane Doe" and "Jan Doe"
 * are one edit apart and are two people, and merging two politicians is a
 * worse error than keeping one person's record in two halves.
 */
export function namesMatch(a: string, b: string): boolean {
  const left = normalizeSpeakerName(a)
  const right = normalizeSpeakerName(b)
  if (!left || !right) return false
  if (left === right) return true

  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left]
  const shortParts = shorter.split(" ")
  if (shortParts.length !== 2) return false

  const longParts = longer.split(" ")
  if (longParts.length < 3) return false

  return longParts[0] === shortParts[0] && longParts[longParts.length - 1] === shortParts[1]
}

/**
 * The alias set stored on a speaker row.
 *
 * Normalized, de-duplicated, empty entries dropped, order stable. This is what
 * `speakers.normalized_aliases` holds, and it is the column an incoming name
 * is matched against, so it must be built with exactly the function that
 * normalizes the incoming name.
 */
export function aliasSet(names: readonly string[]): string[] {
  const out: string[] = []
  for (const name of names) {
    const normalized = normalizeSpeakerName(name)
    if (!normalized || out.includes(normalized)) continue
    out.push(normalized)
  }
  return out
}

/**
 * Pick the display name for a person seen under several spellings.
 *
 * The longest name that still normalizes to the same person, because the
 * longer spelling is the one carrying a middle name or a full first name.
 * Titles are not a reason to prefer a spelling, which is why the comparison is
 * on the raw length of names that already agree after normalization.
 */
export function preferredDisplayName(names: readonly string[]): string {
  const usable = names.map((n) => n.trim()).filter((n) => n.length > 0)
  if (usable.length === 0) return ""

  return usable.reduce((best, name) =>
    normalizeSpeakerName(name).length > normalizeSpeakerName(best).length ? name : best,
  )
}
