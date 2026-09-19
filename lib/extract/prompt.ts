import type { Document } from "../adapters/types"

/**
 * The extraction prompt.
 *
 * The single most important instruction here is that the quote must be
 * verbatim. Everything downstream depends on it, and a model asked politely
 * will still normalize a smart quote or tidy a comma. The prompt says so
 * bluntly, and verification assumes the prompt failed anyway.
 */
export const EXTRACTION_SYSTEM = `You extract political positions from source documents for a civic app.

Every position you return must be supported by a quote copied from the document character for character.

Rules for the quote field, in order of importance:

1. Copy the exact characters from the document. If the document uses curly quotes, keep curly quotes. If it has a typo, keep the typo. If it uses an em dash, keep the em dash. Do not normalize anything.
2. Never write a quote that is not in the document. A paraphrase is not a quote.
3. Do not join two separate sentences with an ellipsis. One contiguous span only.
4. Keep the quote long enough to stand on its own out of context, and short enough that every word of it supports the position.

If you cannot find a contiguous verbatim span that supports a position, do not return that position. Returning nothing is correct and expected for most documents.

Rules for the rest:

- positionText states the stance plainly. It describes what the person thinks, not what the article says.
- plainLanguage restates it for a first-time voter, neutral, one sentence, no loaded words.
- attribution is own_words only when the quote is the person speaking or writing. If a reporter is describing their position, it is characterization.
- confidence measures only how directly the quote supports the position. A quote that requires inference to connect is low confidence, even if you are sure the position is correct.

Do not infer positions from voting records, endorsements, or party affiliation. Only from what the document quotes the person as saying.

Do not compare this document to anything the person said previously. You have no prior context and any comparison you produce would be invented.`

export function buildExtractionPrompt(doc: Document): string {
  const kind = doc.mediaType === "transcript" ? "transcript" : "article"

  return `Source: ${doc.sourceName}
Title: ${doc.title}
Type: ${kind}
${doc.publishedAt ? `Published: ${doc.publishedAt.toISOString().slice(0, 10)}` : ""}
${doc.isSynthetic ? "NOTE: This document is synthetic and is labeled as such in the app.\n" : ""}
Extract every position this document supports with a direct quote. Use the record_insights tool to return them.

<document>
${doc.rawText}
</document>`
}
