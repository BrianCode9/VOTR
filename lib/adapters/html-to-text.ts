/**
 * HTML to plain text, for producing the rawText an adapter stores.
 *
 * This runs exactly once, at ingest, and its output becomes the permanent
 * coordinate space for every quote offset on that document. It therefore has to
 * be deterministic: same input, same output, forever. Do not "improve" it in a
 * way that shifts character positions without also re-ingesting every document
 * and re-verifying every insight, because the offsets already in the database
 * are measured against whatever this function returned on the day it ran.
 */

export const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  hellip: "…",
}

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => {
      const decoded = NAMED_ENTITIES[String(name).toLowerCase()]
      return decoded ?? match
    })
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ""
  try {
    return String.fromCodePoint(code)
  } catch {
    return ""
  }
}

/** Block elements become paragraph breaks so sentences do not weld together. */
const BLOCK_TAGS =
  /<\/?(p|div|section|article|header|footer|h[1-6]|li|ul|ol|blockquote|tr|table|pre|figure|figcaption)\b[^>]*>/gi

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      // script and style content is not prose and must not land in rawText
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(BLOCK_TAGS, "\n\n")
      .replace(/<[^>]+>/g, ""),
  )
    // normalize newlines, then collapse runs of blank lines, but never touch
    // intra-line spacing: the verifier handles whitespace variance itself
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
