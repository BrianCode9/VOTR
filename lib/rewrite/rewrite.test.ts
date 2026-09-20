import { test, describe } from "node:test"
import assert from "node:assert/strict"
import type Anthropic from "@anthropic-ai/sdk"
import {
  MAX_SUMMARY_CHARS,
  rewriteAll,
  rewriteQuote,
  rewriteResultSchema,
  surrounding,
  validateRewrite,
} from "./rewrite"
import { buildRewritePrompt } from "./prompt"
import { toToolSchema } from "../schemas/tool-schema"
import type { NormalizedDocument } from "../adapters/types"
import type { VerifiedItem } from "../schemas/insight"

/**
 * The rewrite pass, without an API call.
 *
 * The property under test throughout is the one the spec is built around: this
 * step is allowed to fail, and a failure must never become an exception, a
 * partial value, or a summary that is really the quote wearing a hat. Every
 * failure is `summary: null` with a reason, and the caller stores null.
 */

const RAW =
  "Reporters pressed the mayor on Tuesday.\n\n" +
  "“We will cap rent increases at three percent next year,” she said, " +
  "adding that the city had lost 4,000 affordable units since 2024."

const QUOTE = "We will cap rent increases at three percent next year"

function doc(): NormalizedDocument {
  return {
    id: "00000000-0000-5000-8000-000000000001",
    sourceUrl: "https://example.test/rent",
    sourceType: "rss",
    sourceName: "Example Herald",
    title: "Mayor backs a rent cap",
    publishedAt: new Date("2026-09-01T00:00:00Z"),
    fetchedAt: new Date("2026-09-02T00:00:00Z"),
    rawText: RAW,
    mediaType: "article",
    isSynthetic: false,
    rawMetadata: {},
  }
}

function item(overrides: Partial<VerifiedItem> = {}): VerifiedItem {
  const start = RAW.indexOf(QUOTE)
  return {
    cardType: "stance",
    topic: "housing",
    topics: ["housing"],
    candidateName: "Mayor Chen",
    headline: "Supports capping rent increases at three percent.",
    plainLanguage: "She wants to limit how much rents can go up.",
    attribution: "own_words",
    confidence: 0.95,
    claimSupportConfidence: 0.95,
    quote: QUOTE,
    quoteHint: { start: 0, end: 0 },
    payload: { cardType: "stance" },
    quoteCharStart: start,
    quoteCharEnd: start + QUOTE.length,
    quoteVerified: "exact",
    similarity: 1,
    occurrences: 1,
    hintDrift: 0,
    ...overrides,
  }
}

/** A client that returns one canned tool call. */
function stubClient(input: unknown, overrides: Partial<Anthropic.Message> = {}) {
  return {
    messages: {
      async create() {
        return {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-opus-5",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "tu_1", name: "record_rewrite", input }],
          usage: { input_tokens: 80, output_tokens: 20, cache_read_input_tokens: 0 },
          ...overrides,
        }
      },
    },
  } as unknown as Anthropic
}

const GOOD = {
  plain_language_summary: "She wants to limit rent increases to three percent next year.",
  reading_level_estimate: 7,
}

describe("the rewrite tool schema", () => {
  test("uses the field names the contract names", () => {
    const schema = toToolSchema(rewriteResultSchema) as Record<string, unknown>
    assert.deepEqual(Object.keys(schema.properties as object).sort(), [
      "plain_language_summary",
      "reading_level_estimate",
    ])
  })

  test("carries no keywords that strict tool use rejects", () => {
    const serialized = JSON.stringify(toToolSchema(rewriteResultSchema))
    for (const keyword of ["minimum", "maximum", "minLength", "maxLength"]) {
      assert.ok(!serialized.includes(`"${keyword}"`), `still has ${keyword}`)
    }
  })
})

describe("validateRewrite", () => {
  test("accepts a good one-sentence rewrite", () => {
    const result = validateRewrite(GOOD, QUOTE)
    assert.ok(result.ok)
    assert.equal(result.readingLevel, 7)
  })

  test("rejects an empty summary", () => {
    // The model's own "I cannot do this without guessing" signal.
    const result = validateRewrite(
      { plain_language_summary: "   ", reading_level_estimate: 7 },
      QUOTE,
    )
    assert.ok(!result.ok)
  })

  test("rejects a summary that is really a paragraph", () => {
    const result = validateRewrite(
      { plain_language_summary: "x".repeat(MAX_SUMMARY_CHARS + 1), reading_level_estimate: 7 },
      QUOTE,
    )
    assert.ok(!result.ok)
  })

  test("rejects more than two sentences", () => {
    const result = validateRewrite(
      {
        plain_language_summary: "She wants a cap. It is three percent. It starts next year.",
        reading_level_estimate: 6,
      },
      QUOTE,
    )
    assert.ok(!result.ok)
  })

  test("rejects the quote handed back as its own rewrite", () => {
    // Shipping this would put the same words in both slots of a card built to
    // show a plain sentence next to the words it restates.
    const result = validateRewrite(
      { plain_language_summary: QUOTE, reading_level_estimate: 7 },
      QUOTE,
    )
    assert.ok(!result.ok)
  })

  test("a nonsense reading level does not sink an otherwise good rewrite", () => {
    // The sentence is the product; the grade estimate is diagnostics. Losing
    // a usable rewrite over a bad number would be the wrong trade.
    const result = validateRewrite({ ...GOOD, reading_level_estimate: 400 }, QUOTE)
    assert.ok(result.ok)
    assert.equal(result.readingLevel, null)
  })
})

describe("rewriteQuote", () => {
  const context = {
    quote: QUOTE,
    surroundingText: RAW,
    headline: "Supports capping rent increases at three percent.",
    candidateName: "Mayor Chen",
    sourceName: "Example Herald",
    cardType: "stance",
  }

  test("returns the summary on a good response", async () => {
    const outcome = await rewriteQuote(context, { client: stubClient(GOOD) })
    assert.equal(outcome.summary, GOOD.plain_language_summary)
    assert.equal(outcome.readingLevel, 7)
    assert.equal(outcome.usage.inputTokens, 80)
  })

  test("a thrown API error is a null summary, not an exception", async () => {
    const client = {
      messages: {
        async create() {
          throw new Error("401 authentication_error")
        },
      },
    } as unknown as Anthropic

    const outcome = await rewriteQuote(context, { client })
    assert.equal(outcome.summary, null)
    assert.match(outcome.reason ?? "", /authentication_error/)
  })

  test("a refusal is a null summary", async () => {
    const client = stubClient(GOOD, {
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber", explanation: "no" },
    } as Partial<Anthropic.Message>)

    const outcome = await rewriteQuote(context, { client })
    assert.equal(outcome.summary, null)
  })

  test("a response with no tool call is a null summary", async () => {
    const client = stubClient(GOOD, {
      stop_reason: "end_turn",
      content: [{ type: "text", text: "I would rather not." }],
    } as Partial<Anthropic.Message>)

    const outcome = await rewriteQuote(context, { client })
    assert.equal(outcome.summary, null)
    assert.match(outcome.reason ?? "", /no tool call/)
  })

  test("a malformed tool input is a null summary", async () => {
    const outcome = await rewriteQuote(context, {
      client: stubClient({ plain_language_summary: 42 }),
    })
    assert.equal(outcome.summary, null)
    assert.match(outcome.reason ?? "", /failed validation/)
  })

  test("output that fails validation is a null summary", async () => {
    const outcome = await rewriteQuote(context, {
      client: stubClient({ plain_language_summary: "", reading_level_estimate: 7 }),
    })
    assert.equal(outcome.summary, null)
  })
})

describe("rewriteInsight and the batch", () => {
  test("slices the quote from the document rather than trusting the item", async () => {
    // The stored offsets are the source of truth, exactly as in the feed.
    let seen = ""
    const client = {
      messages: {
        async create(params: { messages: { content: string }[] }) {
          seen = params.messages[0].content
          return {
            id: "m",
            type: "message",
            role: "assistant",
            model: "claude-opus-5",
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "t", name: "record_rewrite", input: GOOD }],
            usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
          }
        },
      },
    } as unknown as Anthropic

    const batch = await rewriteAll([item()], doc(), { client })
    assert.equal(batch.succeeded, 1)
    assert.ok(seen.includes(QUOTE), "the prompt did not contain the sliced span")
  })

  test("one failure does not take the others down", async () => {
    let call = 0
    const client = {
      messages: {
        async create() {
          call++
          if (call === 1) throw new Error("transient")
          return {
            id: "m",
            type: "message",
            role: "assistant",
            model: "claude-opus-5",
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "t", name: "record_rewrite", input: GOOD }],
            usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
          }
        },
      },
    } as unknown as Anthropic

    const first = item()
    const second = item({ headline: "Another position", quoteCharStart: 0, quoteCharEnd: 38 })

    const batch = await rewriteAll([first, second], doc(), { client })
    assert.equal(batch.succeeded, 1)
    assert.equal(batch.failed, 1)
    assert.equal(batch.outcomes.get(first)?.summary, null)
    assert.equal(batch.outcomes.get(second)?.summary, GOOD.plain_language_summary)
  })

  test("an empty span never reaches the model", async () => {
    const client = {
      messages: {
        async create() {
          throw new Error("should not have been called")
        },
      },
    } as unknown as Anthropic

    const batch = await rewriteAll([item({ quoteCharStart: 5, quoteCharEnd: 5 })], doc(), {
      client,
    })
    assert.equal(batch.failed, 1)
    assert.equal(batch.outcomes.values().next().value?.reason, "empty span")
  })
})

describe("the rewrite prompt", () => {
  test("carries the quote, the context, and the speaker", () => {
    const prompt = buildRewritePrompt({
      quote: QUOTE,
      surroundingText: RAW,
      headline: "Supports a rent cap.",
      candidateName: "Mayor Chen",
      sourceName: "Example Herald",
      cardType: "stance",
    })

    assert.ok(prompt.includes(QUOTE))
    assert.ok(prompt.includes("Mayor Chen"))
    assert.ok(prompt.includes("<context>"))
  })

  test("says so when the document names no speaker", () => {
    const prompt = buildRewritePrompt({
      quote: QUOTE,
      surroundingText: RAW,
      headline: "A rent cap is proposed.",
      candidateName: null,
      sourceName: "Example Herald",
      cardType: "factual_claim",
    })

    assert.ok(prompt.includes("does not name one"))
  })
})

describe("surrounding", () => {
  test("clamps to the document rather than running off either end", () => {
    const text = surrounding(RAW, { quoteCharStart: 0, quoteCharEnd: 10 }, 10_000)
    assert.equal(text, RAW)
  })

  test("includes padding on both sides", () => {
    const start = RAW.indexOf(QUOTE)
    const text = surrounding(RAW, { quoteCharStart: start, quoteCharEnd: start + 10 }, 20)
    assert.ok(text.length > 30)
    assert.ok(RAW.includes(text))
  })
})
