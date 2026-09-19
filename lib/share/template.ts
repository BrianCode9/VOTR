import type { InsightFlag } from "../flags/types"

/**
 * The share card renderer.
 *
 * Deliberately SVG built from a string rather than a headless browser. A
 * browser would render a nicer card and would also mean shipping Chromium into
 * the deploy, a per-request process launch, and a second place where the app's
 * styling lives. What this endpoint has to get right is the pipeline - cache,
 * contract, stable URL - and an SVG is a real, shareable image that exercises
 * all of it while staying a pure function of its input.
 *
 * The visual template is intentionally plain. Swapping it means implementing
 * `ShareRenderer` and registering it; nothing outside this file knows what the
 * card looks like, and the `template` string in the cache key means a new
 * renderer invalidates the old cached images by construction rather than by a
 * migration.
 */

export interface ShareCardData {
  insightId: string
  /** The rewrite, when there is one. The card leads with it. */
  plainLanguageSummary: string | null
  /** The extractor's plain-language line, the fallback headline. */
  plainLanguage: string
  /** The verified quote, sliced from the stored document. */
  quote: string
  sourceName: string
  candidateName: string | null
  flags: InsightFlag[]
  issueTag: string
}

export interface RenderedCard {
  body: string
  contentType: string
  /** "utf8" for text formats, "base64" for raster. */
  encoding: "utf8" | "base64"
  width: number
  height: number
}

export interface ShareRenderer {
  /** Cache key component. Bump it when the output changes. */
  readonly template: string
  render(data: ShareCardData): Promise<RenderedCard>
}

/* ----------------------------------------------------------- helpers --- */

/** The five characters that can break out of SVG text or an attribute. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/**
 * Wrap text to a column, measured in characters.
 *
 * Character counting rather than real font metrics. It is wrong for a line of
 * all Ws and wrong the other way for all Is, and it is right enough for a
 * card whose job is to be legible at thumbnail size. Real metrics would mean
 * parsing a font file, which is a large dependency for a placeholder template.
 */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ")
  const lines: string[] = []
  let current = ""

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxChars) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = word

    // One line of headroom, so the ellipsis lands on the last allowed line
    // rather than producing a card with a line more than it has room for.
    if (lines.length === maxLines) break
  }

  if (lines.length < maxLines && current) lines.push(current)

  if (lines.length === maxLines) {
    const consumed = lines.join(" ").length
    if (consumed < text.replace(/\s+/g, " ").trim().length) {
      lines[maxLines - 1] = truncate(lines[maxLines - 1], maxChars)
    }
  }

  return lines
}

function truncate(line: string, maxChars: number): string {
  if (line.length <= maxChars - 1) return `${line}…`
  return `${line.slice(0, maxChars - 1).trimEnd()}…`
}

/** Human labels for the badges. The card is read by people, not by the enum. */
const FLAG_LABELS: Record<InsightFlag, string> = {
  NEW: "NEW",
  FLIP_FLOP: "CHANGED POSITION",
  UNVERIFIED_CLAIM: "UNVERIFIED CLAIM",
}

export function flagLabel(flag: InsightFlag): string {
  return FLAG_LABELS[flag] ?? flag
}

/* ------------------------------------------------------- the renderer -- */

const WIDTH = 1200
const HEIGHT = 630

/** Character budgets at the sizes used below. See wrapText on why characters. */
const SUMMARY_COLS = 44
const SUMMARY_LINES = 4
const QUOTE_COLS = 74
const QUOTE_LINES = 4

export const svgShareRenderer: ShareRenderer = {
  template: "svg-v1",

  async render(data: ShareCardData): Promise<RenderedCard> {
    // The rewrite is the headline when it exists; the extractor's line is the
    // fallback. The quote is always shown underneath, because the card's whole
    // claim is that the plain sentence has a receipt behind it.
    const headline = data.plainLanguageSummary ?? data.plainLanguage
    const headlineLines = wrapText(headline, SUMMARY_COLS, SUMMARY_LINES)
    const quoteLines = wrapText(`“${data.quote}”`, QUOTE_COLS, QUOTE_LINES)

    const badges = data.flags
      .map((flag, i) => renderBadge(flagLabel(flag), 64 + i * 250, 92))
      .join("\n    ")

    const attribution = data.candidateName
      ? `${data.candidateName} · ${data.sourceName}`
      : data.sourceName

    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(headline)}">
  <defs>
    <style>
      .bg { fill: #0f1216; }
      .panel { fill: #171b21; }
      .eyebrow { font: 600 22px system-ui, -apple-system, "Segoe UI", sans-serif; fill: #8b96a5; letter-spacing: 0.14em; }
      .headline { font: 700 46px system-ui, -apple-system, "Segoe UI", sans-serif; fill: #f4f6f8; }
      .quote { font: italic 400 26px Georgia, "Times New Roman", serif; fill: #c3ccd8; }
      .meta { font: 500 24px system-ui, -apple-system, "Segoe UI", sans-serif; fill: #8b96a5; }
      .badge { font: 700 18px system-ui, -apple-system, "Segoe UI", sans-serif; fill: #0f1216; letter-spacing: 0.08em; }
      .wordmark { font: 800 26px system-ui, -apple-system, "Segoe UI", sans-serif; fill: #6ee7a8; letter-spacing: 0.2em; }
    </style>
  </defs>

  <rect class="bg" width="${WIDTH}" height="${HEIGHT}"/>
  <rect x="0" y="0" width="${WIDTH}" height="8" fill="#6ee7a8"/>

  <text class="wordmark" x="64" y="66">VOTR</text>
  <text class="eyebrow" x="${WIDTH - 64}" y="66" text-anchor="end">${escapeXml(
    data.issueTag.replace(/_/g, " ").toUpperCase(),
  )}</text>

  ${badges}

  ${headlineLines
    .map((line, i) => `<text class="headline" x="64" y="${196 + i * 62}">${escapeXml(line)}</text>`)
    .join("\n  ")}

  <rect class="panel" x="64" y="${452 - quoteLines.length * 36}" width="${WIDTH - 128}" height="${quoteLines.length * 36 + 40}" rx="12"/>
  <rect x="64" y="${452 - quoteLines.length * 36}" width="6" height="${quoteLines.length * 36 + 40}" fill="#6ee7a8" rx="3"/>

  ${quoteLines
    .map(
      (line, i) =>
        `<text class="quote" x="96" y="${482 - quoteLines.length * 36 + i * 36}">${escapeXml(line)}</text>`,
    )
    .join("\n  ")}

  <text class="meta" x="64" y="${HEIGHT - 48}">${escapeXml(attribution)}</text>
  <text class="meta" x="${WIDTH - 64}" y="${HEIGHT - 48}" text-anchor="end">Quote verified against the source</text>
</svg>
`

    return { body, contentType: "image/svg+xml", encoding: "utf8", width: WIDTH, height: HEIGHT }
  },
}

function renderBadge(label: string, x: number, y: number): string {
  const width = label.length * 11 + 32
  return `<g>
      <rect x="${x}" y="${y}" width="${width}" height="34" rx="17" fill="#6ee7a8"/>
      <text class="badge" x="${x + 16}" y="${y + 23}">${escapeXml(label)}</text>
    </g>`
}
