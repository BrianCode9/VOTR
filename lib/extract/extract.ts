import Anthropic from "@anthropic-ai/sdk"
import type { Document } from "../adapters/types"
import {
  extractionResultSchema,
  type ExtractedInsight,
  type VerifiedInsight,
} from "../schemas/insight"
import { toToolSchema } from "../schemas/tool-schema"
import { EXTRACTION_SYSTEM, buildExtractionPrompt } from "./prompt"
import { verifyQuote } from "./verify"

/**
 * Extraction, step 3 of the pipeline, followed immediately by verification.
 *
 * These two are deliberately in one function. An ExtractedInsight carrying an
 * unverified quote string is a dangerous value to hand around: it looks exactly
 * like a verified one and nothing in its type says otherwise. Callers only ever
 * receive VerifiedInsight, which cannot exist without real offsets.
 */

export const EXTRACTION_MODEL = "claude-opus-5"

const TOOL_NAME = "record_insights"

/**
 * Built once at module load: the tool list is part of the cache prefix, so it
 * must be byte-identical on every request or caching silently stops working.
 */
const RECORD_INSIGHTS_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Record the positions found in this document, each with a verbatim supporting quote.",
  input_schema: toToolSchema(extractionResultSchema),
  strict: true,
}

export interface ExtractionRun {
  verified: VerifiedInsight[]
  /** Quotes the model returned that are not actually in the document. */
  rejected: { insight: ExtractedInsight; reason: string }[]
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
  }
  /** Set when the model declined or the response was unusable. */
  error?: string
}

export async function extractInsights(
  doc: Document,
  client: Anthropic = new Anthropic(),
): Promise<ExtractionRun> {
  const empty: ExtractionRun = {
    verified: [],
    rejected: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
  }

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 16000,
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
      tools: [RECORD_INSIGHTS_TOOL],
      // Forced tool_choice is incompatible with extended thinking, so the tool
      // is named in the prompt instead and `strict` keeps the arguments valid.
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: buildExtractionPrompt(doc) }],
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
  // outcome for most documents and is not an error.
  if (!toolUse) return { ...empty, usage }

  const parsed = extractionResultSchema.safeParse(toolUse.input)
  if (!parsed.success) {
    return { ...empty, usage, error: `tool input failed validation: ${parsed.error.message}` }
  }

  const verified: VerifiedInsight[] = []
  const rejected: ExtractionRun["rejected"] = []

  for (const insight of parsed.data.insights) {
    const result = verifyQuote(insight.quote, doc)
    if (!result.ok) {
      rejected.push({ insight, reason: result.reason })
      continue
    }
    verified.push({
      ...insight,
      quoteCharStart: result.start,
      quoteCharEnd: result.end,
      rung: result.rung,
      occurrences: result.occurrences,
    })
  }

  return { verified, rejected, usage }
}
