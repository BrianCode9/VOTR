/**
 * The plain-language rewrite prompt.
 *
 * A separate call from extraction, on purpose. Extraction is a careful,
 * high-stakes pass over a whole document with a verbatim-quote contract; this
 * is a one-sentence restatement of a span that has already been verified. Folding
 * it into the extraction call would make every rewrite failure an extraction
 * failure, and the whole point of this step is that it is allowed to fail
 * without taking an insight down with it.
 *
 * The system half is byte-stable so it caches across every insight in a run.
 * The quote and its surrounding context go in the user message, after the
 * cache breakpoint.
 */

export const REWRITE_SYSTEM = `You rewrite one political quote into one plain sentence for a civic app, for readers who are voting for the first time.

You are given a quote that has already been checked against its source document, plus the text around it for context. Return one sentence that says what the quote says.

What the sentence must do:

1. Preserve the substance. If the quote commits to a policy, your sentence commits to that policy. If it makes a numeric claim, keep the number. If it is hedged, keep the hedge: "would consider" is not "will do". Do not soften a hard position and do not harden a soft one.
2. Stay neutral. No loaded adjectives, no words that tell the reader how to feel, no implied motive. "wants to cut the housing budget" is neutral. "wants to gut housing" and "wants to responsibly trim housing" are both wrong.
3. Drop the jargon. Replace insider terms with what they mean: not "appropriations markup" but "a meeting where lawmakers decide how to spend money". If a term cannot be replaced without losing the substance, keep it and explain it in the same sentence.
4. Read at a sixth to eighth grade level. Short common words. One idea per clause. Active voice. Aim for under 30 words.

What the sentence must not do:

- Do not add facts that are not in the quote or the surrounding context.
- Do not evaluate whether the position is good, popular, realistic, or affordable.
- Do not describe the speaker's character or intent.
- Do not start with "The speaker says" or "This quote means". Just say the thing.
- Do not quote. Your sentence replaces the quote for a reader who wants the gist; the original is shown next to it.

Attribute by role or name when the context supplies one, and write "they" for a person whose pronouns the document does not state.

Also report reading_level_estimate: the US school grade level of the sentence you wrote, as a number. Estimate it honestly rather than reporting the target. A sentence you know reads at grade 11 should say 11, because that tells us the rewrite needs work.

Call the record_rewrite tool with your answer. If the quote cannot be restated without either adding facts or taking a side, call the tool with an empty plain_language_summary rather than guessing: the app falls back to showing the original quote, which is always correct.`

export interface RewriteContext {
  /** The verified quote, sliced from the stored document. */
  quote: string
  /** Text around the quote, for pronouns and antecedents. */
  surroundingText: string
  /** What the extractor said this card claims, as a cross-check. */
  headline: string
  /** null when the document names no speaker. */
  candidateName: string | null
  sourceName: string
  /** Which kind of card this is, which changes what "the substance" means. */
  cardType: string
}

/**
 * Render the user message.
 *
 * The quote is repeated outside the context block even though it also appears
 * inside it. That redundancy is deliberate: the model is being asked to
 * restate one specific span, and locating it inside a paragraph is a task it
 * does not need to be doing.
 */
export function buildRewritePrompt(context: RewriteContext): string {
  const speaker = context.candidateName
    ? `Speaker: ${context.candidateName}`
    : "Speaker: the document does not name one. Write about what was said, not who said it."

  return `${speaker}
Source: ${context.sourceName}
Card type: ${context.cardType}
What the extractor recorded this as: ${context.headline}

The quote to rewrite:
<quote>
${context.quote}
</quote>

The surrounding text, for context only. Do not restate anything that is here but not in the quote:
<context>
${context.surroundingText}
</context>

Rewrite the quote as one plain sentence using the record_rewrite tool.`
}
