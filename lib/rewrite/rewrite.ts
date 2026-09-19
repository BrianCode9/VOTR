import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import type { NormalizedDocument } from "../adapters/types"
import type { VerifiedItem } from "../schemas/insight"
import { toToolSchema } from "../schemas/tool-schema"
import { REWRITE_SYSTEM, buildRewritePrompt, type RewriteContext } from "./prompt"

/**
 * The plain-language rewrite pass.
 *
 * Runs after verification, on verified insights only, and is allowed to fail.
 * That second property is the design constraint the whole module is built
 * around: nothing in here can throw into the pipeline, and every failure path
 * ends at `{ summary: null }`, which the storage layer writes as a null column
 * and every read path falls back from to the original quote.
 *
 * Why only verified insights: a rewrite of a quote that does not exist in the
 * source is a fabricated sentence with no receipt behind it. The rewrite
 * inherits its credibility entirely from the span it restates, so it is never
 * produced for a span that failed the ladder.
 */

export const REWRITE_MODEL = process.env.REWRITE_MODEL ?? "claude-opus-5"

const TOOL_NAME = "record_rewrite"

/**
 * The structured output contract.
 *
 * snake_case because it is a wire format that the spec names field by field,
 * not an internal type. `toPlainLanguage` converts it to the camelCase shape
 * the rest of the codebase uses, and that boundary is the only place the two
 * spellings meet.
 */
export const rewriteResultSchema = z.object({
  plain_language_summary: z
    .string()
    .describe(
      "One neutral sentence restating the quote at a sixth to eighth grade " +
        "reading level. Empty string if the quote cannot be restated without " +
        "adding facts or taking a side.",
    ),
  reading_level_estimate: z
    .number()
    .describe(
      "The US school grade level of the sentence you actually wrote, as a " +
        "number. Report what you wrote, not the target.",
    ),
})

export type RewriteResult = z.infer<typeof rewriteResultSchema>

/** Built once at module load so the tool list stays byte-identical and caches. */
const RECORD_REWRITE_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Record the plain-language rewrite of a quote, and the reading level of " +
    "the sentence you wrote.",
  input_schema: toToolSchema(rewriteResultSchema),
  strict: true,
}

/* --------------------------------------------------------- validation -- */

/**
 * How long a "one sentence" summary may be before it is not one.
 *
 * A rewrite that runs long has usually started explaining the context rather
 * than restating the quote, which is the failure mode that quietly adds facts.
 */
export const MAX_SUMMARY_CHARS = 320

/** More than this many sentence terminators means it is not one sentence. */
const MAX_SENTENCES = 2

/** Grade levels outside this range are not a reading level, they are a typo. */
const READING_LEVEL_RANGE = { min: 1, max: 20 }

export interface RewriteOutcome {
  /** null whenever anything went wrong. Never a partial or guessed value. */
  summary: string | null
  readingLevel: number | null
  /** Why it is null, for logs. Absent on success. */
  reason?: string
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number }
}

const NO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }

/**
 * Structural checks on a parsed rewrite.
 *
 * Deliberately structural only. Whether the sentence is neutral and faithful
 * is not something a regex can decide, and a validator that pretended to
 * would be worse than none: it would license trusting output it cannot
 * actually check. What it does catch is the shapes that are definitely wrong -
 * empty, truncated, a paragraph, a quote copied back verbatim.
 */
export function validateRewrite(
  result: RewriteResult,
  original: string,
): { ok: true; summary: string; readingLevel: number | null } | { ok: false; reason: string } {
  const summary = result.plain_language_summary.trim()

  // The model's own "I cannot do this without guessing" signal, per the prompt.
  if (summary.length === 0) return { ok: false, reason: "model returned an empty summary" }
  if (summary.length > MAX_SUMMARY_CHARS) {
    return { ok: false, reason: `summary is ${summary.length} chars, over ${MAX_SUMMARY_CHARS}` }
  }

  const sentences = summary.split(/[.!?](?:\s|$)/).filter((s) => s.trim().length > 0)
  if (sentences.length > MAX_SENTENCES) {
    return { ok: false, reason: `summary is ${sentences.length} sentences` }
  }

  // A rewrite that is the quote again has done nothing, and shipping it would
  // put the same words in both slots of a card built to show them differing.
  if (normalize(summary) === normalize(original)) {
    return { ok: false, reason: "summary is the original quote" }
  }

  const level = result.reading_level_estimate
  const readingLevel =
    Number.isFinite(level) && level >= READING_LEVEL_RANGE.min && level <= READING_LEVEL_RANGE.max
      ? Number(level.toFixed(1))
      : null

  return { ok: true, summary, readingLevel }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

/* -------------------------------------------------------------- call --- */

export interface RewriteOptions {
  client?: Anthropic
  maxTokens?: number
  /** How much text on each side of the quote to send as context. */
  contextPadding?: number
}

/** Default window around the quote. Enough for antecedents, short enough to cache well. */
export const DEFAULT_CONTEXT_PADDING = 500

/**
 * Rewrite one verified quote.
 *
 * Every failure - a missing API key, a refusal, a timeout, a malformed tool
 * call, a summary that fails validation - returns `{ summary: null }` with a
 * reason. Nothing throws. The caller writes what it got and moves on.
 */
export async function rewriteInsight(
  item: VerifiedItem,
  doc: NormalizedDocument,
  options: RewriteOptions = {},
): Promise<RewriteOutcome> {
  const quote = doc.rawText.slice(item.quoteCharStart, item.quoteCharEnd)
  if (!quote.trim()) {
    return { summary: null, readingLevel: null, reason: "empty span", usage: NO_USAGE }
  }

  return rewriteQuote(
    {
      quote,
      surroundingText: surrounding(doc.rawText, item, options.contextPadding),
      headline: item.headline,
      candidateName: item.candidateName,
      sourceName: doc.sourceName,
      cardType: item.cardType,
    },
    options,
  )
}

/** The context window around a span, clamped to the document. */
export function surrounding(
  rawText: string,
  span: { quoteCharStart: number; quoteCharEnd: number },
  padding = DEFAULT_CONTEXT_PADDING,
): string {
  const start = Math.max(0, span.quoteCharStart - padding)
  const end = Math.min(rawText.length, span.quoteCharEnd + padding)
  return rawText.slice(start, end)
}

/**
 * The model call, separated from the insight shape so it can be tested with a
 * stub client and reused by anything else that has a quote and its context.
 */
export async function rewriteQuote(
  context: RewriteContext,
  options: RewriteOptions = {},
): Promise<RewriteOutcome> {
  let client: Anthropic
  try {
    client = options.client ?? new Anthropic()
  } catch (e) {
    // No API key configured. Expected on a machine that only runs the feed.
    return {
      summary: null,
      readingLevel: null,
      reason: e instanceof Error ? e.message : String(e),
      usage: NO_USAGE,
    }
  }

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: REWRITE_MODEL,
      max_tokens: options.maxTokens ?? 8000,
      thinking: { type: "adaptive" },
      // One sentence from a short span does not need deep reasoning, and the
      // rewrite runs once per insight, so this is the pass where effort is
      // worth spending carefully rather than by default.
      output_config: { effort: "low" },
      system: [
        {
          type: "text",
          text: REWRITE_SYSTEM,
          // Identical on every insight, so it caches for a whole run.
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [RECORD_REWRITE_TOOL],
      // Forced tool_choice is incompatible with extended thinking, so the tool
      // is named in the prompt and `strict` keeps the arguments valid.
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: buildRewritePrompt(context) }],
    })
  } catch (e) {
    return {
      summary: null,
      readingLevel: null,
      reason: e instanceof Error ? e.message : String(e),
      usage: NO_USAGE,
    }
  }

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
  }

  if (response.stop_reason === "refusal") {
    return {
      summary: null,
      readingLevel: null,
      reason: `model refused: ${response.stop_details?.category}`,
      usage,
    }
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === TOOL_NAME,
  )
  if (!toolUse) {
    return { summary: null, readingLevel: null, reason: "no tool call in response", usage }
  }

  const parsed = rewriteResultSchema.safeParse(toolUse.input)
  if (!parsed.success) {
    return {
      summary: null,
      readingLevel: null,
      reason: `tool input failed validation: ${parsed.error.message}`,
      usage,
    }
  }

  const checked = validateRewrite(parsed.data, context.quote)
  if (!checked.ok) {
    return { summary: null, readingLevel: null, reason: checked.reason, usage }
  }

  return { summary: checked.summary, readingLevel: checked.readingLevel, usage }
}

/* ------------------------------------------------------------- batch --- */

export interface RewriteBatchResult {
  /** Indexed by the item's quoteCharStart, which is unique per card type. */
  outcomes: Map<VerifiedItem, RewriteOutcome>
  succeeded: number
  failed: number
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number }
}

/**
 * Rewrite every item from one document.
 *
 * Sequential rather than parallel. The system prompt is the cached prefix, and
 * firing N requests at once means N cache misses instead of one write and N-1
 * reads. A document yields a handful of insights, so the latency cost is small
 * and the token cost saved is not.
 */
export async function rewriteAll(
  items: VerifiedItem[],
  doc: NormalizedDocument,
  options: RewriteOptions = {},
): Promise<RewriteBatchResult> {
  const outcomes = new Map<VerifiedItem, RewriteOutcome>()
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  let succeeded = 0
  let failed = 0

  for (const item of items) {
    const outcome = await rewriteInsight(item, doc, options)
    outcomes.set(item, outcome)
    usage.inputTokens += outcome.usage.inputTokens
    usage.outputTokens += outcome.usage.outputTokens
    usage.cacheReadTokens += outcome.usage.cacheReadTokens
    if (outcome.summary) succeeded++
    else failed++
  }

  return { outcomes, succeeded, failed, usage }
}
