import Anthropic from "@anthropic-ai/sdk"
import type { NormalizedDocument } from "../adapters/types"
import {
  extractionResultSchema,
  flattenExtraction,
  type ExtractedItem,
  type VerifiedItem,
} from "../schemas/insight"
import { toToolSchema } from "../schemas/tool-schema"
import { EXTRACTION_SYSTEM, buildExtractionPrompt, type PromptContext } from "./prompt"
import { verifyQuote, type VerifyOptions } from "./verify"

/**
 * Extraction, followed immediately by verification.
 *
 * These two are deliberately in one function. An ExtractedItem carrying an
 * unverified quote string is a dangerous value to hand around: it looks exactly
 * like a verified one and nothing in its type says otherwise. Callers only ever
 * receive VerifiedItem, which cannot exist without real offsets.
 */

export const EXTRACTION_MODEL = "claude-opus-5"

const TOOL_NAME = "record_extraction"

/**
 * Built once at module load: the tool list is part of the cache prefix, so it
 * must be byte-identical on every request or caching silently stops working.
 */
const RECORD_EXTRACTION_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Record the stances, stance changes, factual claims, and voter-relevant risks " +
    "and opportunities found in this document, each with a verbatim supporting quote.",
  input_schema: toToolSchema(extractionResultSchema),
  strict: true,
}

export interface RejectedItem {
  item: ExtractedItem
  reason: string
}

export interface ExtractionRun {
  verified: VerifiedItem[]
  /** Items whose quote is not actually in the document. Never shown to users. */
  rejected: RejectedItem[]
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
  }
  /** Set when the model declined or the response was unusable. */
  error?: string
}

export interface ExtractOptions extends PromptContext {
  client?: Anthropic
  verify?: VerifyOptions
  maxTokens?: number
}

export async function extractInsights(
  doc: NormalizedDocument,
  options: ExtractOptions = {},
): Promise<ExtractionRun> {
  const client = options.client ?? new Anthropic()

  const empty: ExtractionRun = {
    verified: [],
    rejected: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
  }

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: options.maxTokens ?? 16000,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: EXTRACTION_SYSTEM,
          // The system prompt and tool list are identical on every document,
          // so they cache. The document itself sits after the breakpoint.
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [RECORD_EXTRACTION_TOOL],
      // Forced tool_choice is incompatible with extended thinking, so the tool
      // is named in the prompt instead and `strict` keeps the arguments valid.
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: buildExtractionPrompt(doc, {
            priorStances: options.priorStances,
            knownSpeakers: options.knownSpeakers,
            topicVocabulary: options.topicVocabulary,
          }),
        },
      ],
    })
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) }
  }

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
  }

  if (response.stop_reason === "refusal") {
    return { ...empty, usage, error: `model refused: ${response.stop_details?.category}` }
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === TOOL_NAME,
  )

  // No tool call means the model found nothing quotable, which is the expected
  // outcome for many documents and is not an error.
  if (!toolUse) return { ...empty, usage }

  const parsed = extractionResultSchema.safeParse(toolUse.input)
  if (!parsed.success) {
    return {
      ...empty,
      usage,
      error: `tool input failed validation: ${parsed.error.message}`,
    }
  }

  const { verified, rejected } = verifyItems(
    flattenExtraction(parsed.data),
    doc,
    options.verify,
  )

  return { verified, rejected, usage }
}

/**
 * Run every extracted item through the quote ladder.
 *
 * Exported separately so the verification half can be tested, and replayed
 * over a stored model response, without an API call.
 */
export function verifyItems(
  items: ExtractedItem[],
  doc: NormalizedDocument,
  options?: VerifyOptions,
): { verified: VerifiedItem[]; rejected: RejectedItem[] } {
  const verified: VerifiedItem[] = []
  const rejected: RejectedItem[] = []

  for (const item of items) {
    const result = verifyQuote(item.quote, doc, options)

    // The only exit for an unverifiable item. It is not stored as an insight,
    // it is not flagged and rendered, it does not reach a user. The caller
    // writes it to the rejections table, which is a failure log, not a feed.
    if (!result.ok) {
      rejected.push({ item, reason: result.reason })
      continue
    }

    verified.push({
      ...item,
      quoteCharStart: result.start,
      quoteCharEnd: result.end,
      quoteVerified: result.rung,
      similarity: result.similarity,
      occurrences: result.occurrences,
      // The model's guess is kept only as a signal. Large drift on a quote
      // that still verified usually means the model reconstructed the span
      // from memory rather than copying it.
      hintDrift: Math.abs(item.quoteHint.start - result.start),
    })
  }

  return { verified, rejected }
}
