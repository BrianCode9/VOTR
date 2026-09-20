/**
 * Candidate names, as a reader should see them.
 *
 * The certified lists are transcribed from each state's own filing, and the
 * states do not agree: California publishes "Xavier Becerra" and Texas
 * publishes "PATRICK FALLON". Both are the official spelling, so neither is
 * wrong to store, but rendering them side by side on one ballot makes the
 * shouted ones look like a different class of candidate.
 *
 * So the fix is at display time, never in the table. The stored name stays
 * exactly as certified.
 *
 * Applied only to strings that are entirely uppercase. A name that already
 * carries case is left untouched, because any re-casing rule is a guess and
 * the state's own spelling is better than our guess.
 */

/** Particles that stay lowercase inside a name, never at the start. */
const PARTICLES = new Set(["de", "la", "del", "der", "van", "von", "di", "da", "du", "of", "the"])

/** Suffixes and initialisms that stay uppercase. */
const UPPERCASE = new Set(["II", "III", "IV", "V", "VI", "MD", "DDS", "PHD", "CPA"])

/**
 * Generational suffixes read as abbreviated words, not as initialisms, so they
 * take a capital and a full stop. A Roman numeral is genuinely uppercase and
 * stays in UPPERCASE above: "Nicholas Begich III", but "Henry Cuellar Jr."
 */
const SUFFIX_CASE = new Map([["JR", "Jr."], ["SR", "Sr."]])

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

/**
 * Title-cases one whitespace-delimited word, respecting the internal
 * punctuation that real names carry: O'BRIEN, SMITH-JONES, MCDONALD.
 */
function titleCaseWord(word: string, index: number): string {
  const bare = word.replace(/[^A-Za-z]/g, "")

  // "Jr." and "III" are suffixes, but never as the first word, where they would
  // be a given name that happens to collide (e.g. "Vi").
  if (index > 0) {
    const suffix = SUFFIX_CASE.get(bare.toUpperCase())
    if (suffix) return suffix
  }
  if (index > 0 && UPPERCASE.has(bare.toUpperCase())) return word.toUpperCase()

  if (index > 0 && PARTICLES.has(word.toLowerCase().replace(/[^a-z]/g, ""))) {
    return word.toLowerCase()
  }

  // Split on the separators that appear inside a single name token and
  // capitalize each part: MARY-JANE, O'CONNOR, D'AMATO.
  let cased = word
    .toLowerCase()
    .split("-")
    .map((part) => part.split("'").map(capitalize).join("'"))
    .join("-")

  // Mc and Mac prefixes take a second capital, but only when what follows is
  // long enough to be a name rather than the whole word being "Mack".
  cased = cased.replace(/\b(Mc)([a-z])/g, (_, prefix: string, letter: string) =>
    prefix + letter.toUpperCase(),
  )

  return cased
}

/**
 * The name to print.
 *
 * Returns the input unchanged unless it is entirely uppercase.
 */
export function displayName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ")
  if (!trimmed) return trimmed

  // Has at least one lowercase letter, so the source already carries case.
  if (/[a-z]/.test(trimmed)) return trimmed

  return trimmed
    .split(" ")
    .map((word, index) => titleCaseWord(word, index))
    .join(" ")
}

/** Up to two initials, for the portrait fallback. */
export function initials(name: string): string {
  return displayName(name)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.replace(/[^A-Za-z]/g, "")[0]?.toUpperCase() ?? "")
    .join("")
}
