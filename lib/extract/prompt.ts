import type { NormalizedDocument } from "../adapters/types"
import type { PriorStance } from "../schemas/insight"

/**
 * The extraction prompt.
 *
 * The single most important instruction here is that the quote must be
 * verbatim. Everything downstream depends on it, and a model asked politely
 * will still normalize a smart quote or tidy a comma. The prompt says so
 * bluntly, and verification assumes the prompt failed anyway.
 *
 * The system half is byte-stable so it can be cached across every document.
 * Anything that varies per document - including the prior stances - belongs in
 * the user message, after the cache breakpoint.
 */
export const EXTRACTION_SYSTEM = `You extract political positions, claims, and voter impacts from source documents for a civic app.

Everything you return must be supported by a quote copied from the document character for character.

Rules for the quote field, in order of importance:

1. Copy the exact characters from the document. If the document uses curly quotes, keep curly quotes. If it has a typo, keep the typo. If it uses an em dash, keep the em dash. Do not normalize anything.
2. Never write a quote that is not in the document. A paraphrase is not a quote.
3. Do not join two separate sentences with an ellipsis. One contiguous span only.
4. Keep the quote long enough to stand on its own out of context, and short enough that every word of it supports the item.

Quotes are checked against the stored document after you answer. An item whose quote cannot be located there is discarded, and a discarded item is worse than an item you never returned, because it costs a rejection in the public failure log.

If you cannot find a contiguous verbatim span that supports an item, do not return that item. Returning nothing is correct and expected for most documents.

You return four kinds of item.

STANCES. A position a named person holds. positionSummary describes what the person thinks, not what the article says. Do not infer positions from voting records, endorsements, or party affiliation. Only from what the document quotes the person as saying or is reported to have said.

STANCE CHANGES. Only when the PRIOR STANCES block in the user message contains a record that genuinely conflicts with this document. This is the one place you are allowed to compare across documents, and only against the records given to you. If the user message says there are no prior stances, stanceChanges must be an empty array. Never compare against your own knowledge of what a person has said, and never treat a difference in wording, emphasis, or the question being answered as a change of position. When in doubt, return nothing: a false flip-flop accusation is the most damaging error this system can make.

FACTUAL CLAIMS. Specific assertions in the document that could be checked against a source. Rate how checkable each one is. A claim about the future, about intent, or about what is good is not checkable, it is unverifiable, and saying so is useful.

VOTER RELEVANCE. A concrete risk or opportunity for an identifiable group of people, following from the quoted material. Name the group as specifically as the document supports. Do not speculate about effects the document does not state, and do not editorialize: describe what the stated policy would do, not whether it is wise.

Rules that apply to all four:

- plainLanguage restates the item for a first-time voter, neutral, one sentence, no loaded words.
- attribution is own_words only when the quote is the person speaking or writing. If a reporter is describing their position, it is characterization.
- topic must be one of the given issue tags. Use "other" rather than forcing a bad fit.
- candidateName is copied from the document. Use an empty string when the document names no one, rather than guessing.
- The same quote may legitimately support items of different kinds. Do not return the same quote twice for the same kind.
- Report your offsets as your best estimate. They are corrected against the document, so an estimate is more useful than a refusal.`

export interface PromptContext {
  /** Prior verified stances for the speakers in this document. */
  priorStances?: PriorStance[]
  /** Names known to be on the ballot, to steer candidateName spelling. */
  knownSpeakers?: string[]
  /**
   * The issue vocabulary, read from the topics table.
   *
   * Lives in the user message rather than the cached system prompt because it
   * comes from a table that can change. Putting a mutable list in the cached
   * prefix would silently drop the cache hit rate to zero the first time
   * anyone added a topic.
   */
  topicVocabulary?: string[]
}

/**
 * Render the prior stance block.
 *
 * The ids are included because the model is asked to name the record it
 * compared against. A stance change whose priorInsightId resolves to a real
 * row is one the pipeline can link with stance_links; one that does not is a
 * signal the comparison was invented.
 */
function renderPriorStances(priors: PriorStance[]): string {
  if (priors.length === 0) {
    return `PRIOR STANCES: none on record for anyone in this document.
Because there are no prior stances, stanceChanges MUST be an empty array. You have no history to compare against and any comparison you produce would be invented.`
  }

  const lines = priors.map((p) => {
    const when = p.publishedAt ? p.publishedAt.toISOString().slice(0, 10) : "date unknown"
    return `- id: ${p.id}
  speaker: ${p.candidateName}
  topic: ${p.topic}
  recorded position: ${p.positionSummary}
  their words then: "${p.quote}"
  source: ${p.sourceName}, ${when}`
  })

  return `PRIOR STANCES already verified for the people in this document. These are the ONLY records you may compare against:

${lines.join("\n")}

Return a stanceChange only where this document contradicts or materially shifts from one of the records above, and copy that record's id into priorInsightId.`
}

/**
 * Render the issue vocabulary block.
 *
 * `topic` is constrained by the tool schema's enum and needs no help. This
 * block exists for `topics`, which is an array of free strings precisely so
 * the taxonomy can grow without a deploy, and which therefore has to be told
 * what the legal values are somewhere.
 */
function renderTopicVocabulary(vocabulary: string[] | undefined): string {
  if (!vocabulary || vocabulary.length === 0) {
    return `ISSUE TAGS: use only the values allowed by the topic field's schema. Put that same value in topics as the only entry.`
  }

  return `ISSUE TAGS, the only legal values for the topics array:
${vocabulary.join(", ")}

List the primary topic first. Add a second or third only when the item genuinely belongs to both, and leave anything else off: a tag that is not on this list is discarded, and a tag that does not fit makes the item show up in a feed the reader did not ask for.`
}

export function buildExtractionPrompt(
  doc: NormalizedDocument,
  context: PromptContext = {},
): string {
  const kind = doc.mediaType === "transcript" ? "transcript" : "article"
  const priors = context.priorStances ?? []

  const header = [
    `Source: ${doc.sourceName}`,
    `Title: ${doc.title}`,
    `Type: ${kind}`,
    doc.publishedAt ? `Published: ${doc.publishedAt.toISOString().slice(0, 10)}` : null,
    doc.isSynthetic
      ? "NOTE: This document is synthetic and is labeled as such in the app."
      : null,
    context.knownSpeakers?.length
      ? `Known people on this ballot: ${context.knownSpeakers.join(", ")}. ` +
        `Spell candidateName this way when the document refers to one of them.`
      : null,
  ]
    .filter(Boolean)
    .join("\n")

  return `${header}

${renderTopicVocabulary(context.topicVocabulary)}

${renderPriorStances(priors)}

Extract from the document below using the record_extraction tool.

<document>
${doc.rawText}
</document>`
}
