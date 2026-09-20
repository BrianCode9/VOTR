import { createHash } from "node:crypto"
import { z } from "zod"
import { issueTagSchema } from "../schemas/insight"

export const evidenceSchema = z.object({
  sourceKey: z.string().min(1),
  url: z.string().url(),
  sha256: z.string().length(64),
  claims: z.array(z.object({
    issueTag: issueTagSchema,
    quote: z.string().min(10),
    positionText: z.string().min(10),
  })),
  biography: z.object({ text: z.string().min(10), quote: z.string().min(10) }).optional(),
})

/** Normalize only NEW documents. PostgreSQL counts code points, JS UTF-16 units.
 * Replacing non-BMP symbols before offsets are assigned keeps both readers aligned.
 * Existing stored documents are never changed.
 */
export function evidenceText(rawText: string): string {
  return rawText.replace(/[^\u0000-\uFFFF]/gu, "\uFFFD")
}

export function exactSpan(rawText: string, quote: string) {
  const start = rawText.indexOf(quote)
  if (start < 0) throw new Error("Quote missing from source")
  if (rawText.indexOf(quote, start + 1) >= 0) throw new Error("Quote is ambiguous")
  return { start, end: start + quote.length }
}

export function validateEvidence(input: unknown, page: { sourceKey: string; url: string; rawText: string; kind: string }) {
  const evidence = evidenceSchema.parse(input)
  if (evidence.sourceKey !== page.sourceKey || evidence.url !== page.url) throw new Error("Candidate/source identity mismatch")
  if (createHash("sha256").update(page.rawText).digest("hex") !== evidence.sha256) throw new Error("Reviewed source has changed")
  const rawText = evidenceText(page.rawText)
  const claims = evidence.claims.map(c => ({ ...c, ...exactSpan(rawText, c.quote) }))
  if (evidence.biography) exactSpan(rawText, evidence.biography.quote)
  if (page.kind !== "official_office") {
    const words = [...claims.map(c => c.quote), evidence.biography?.quote ?? ""].join(" ").trim().split(/\s+/).length
    if (words > 25) throw new Error("Campaign excerpt budget exceeded")
  }
  return { ...evidence, rawText, claims }
}
