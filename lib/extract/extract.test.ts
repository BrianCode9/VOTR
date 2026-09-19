import { test, describe } from "node:test"
import assert from "node:assert/strict"
import type Anthropic from "@anthropic-ai/sdk"
import { extractInsights, verifyItems } from "./extract"
import { toToolSchema } from "../schemas/tool-schema"
import {
  extractionResultSchema,
  flattenExtraction,
  type ExtractionResult,
} from "../schemas/insight"
import type { NormalizedDocument } from "../adapters/types"

/**
 * The extraction path without an API call.
 *
 * The model is stubbed so the parts that are ours - schema validation, the
 * flattening of four families into one list, verification, and the rejection
 * path - are tested deterministically. What the model actually returns is not
 * something a unit test can assert anyway; what the pipeline does with a bad
 * response is.
 */

const RAW =
  "Reporters pressed the mayor on Tuesday.\n\n" +
  "“We will cap rent increases at three percent next year,” she said, " +
  "adding that the city had lost 4,000 affordable units since 2024. " +
  "Landlord groups said the cap would stall new construction."

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

/** An Anthropic client that returns one canned tool call. */
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
          content: [{ type: "tool_use", id: "tu_1", name: "record_extraction", input }],
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
          ...overrides,
        }
      },
    },
  } as unknown as Anthropic
}

function result(partial: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    stances: [],
    stanceChanges: [],
    factualClaims: [],
    voterRelevance: [],
    ...partial,
  }
}

const STANCE = {
  topic: "housing" as const,
  topics: ["housing"],
  candidateName: "Mayor Chen",
  positionSummary: "Supports capping rent increases at three percent.",
  plainLanguage: "She wants to limit how much rents can go up.",
  attribution: "own_words" as const,
  confidence: 0.95,
  quote: "We will cap rent increases at three percent next year",
  quoteCharStart: 0,
  quoteCharEnd: 0,
}

describe("the extraction tool schema", () => {
  test("describes all four families", () => {
    const schema = toToolSchema(extractionResultSchema) as Record<string, unknown>
    const properties = schema.properties as Record<string, unknown>

    assert.deepEqual(Object.keys(properties).sort(), [
      "factualClaims",
      "stanceChanges",
      "stances",
      "voterRelevance",
    ])
  })

  test("carries no JSON Schema keywords that strict tool use rejects", () => {
    // Range and length keywords make the API reject the tool outright. Zod
    // still enforces them when validating the response, which is where the
    // guarantee actually matters.
    const banned = ["minimum", "maximum", "minLength", "maxLength", "pattern", "minItems"]
    const serialized = JSON.stringify(toToolSchema(extractionResultSchema))

    for (const keyword of banned) {
      assert.ok(!serialized.includes(`"${keyword}"`), `tool schema still has ${keyword}`)
    }
  })
})

describe("flattenExtraction", () => {
  test("the four families become one discriminated list", () => {
    const items = flattenExtraction(
      result({
        stances: [STANCE],
        factualClaims: [
          {
            topic: "housing",
  topics: ["housing"],
            candidateName: "Mayor Chen",
            claimText: "The city lost 4,000 affordable units since 2024.",
            plainLanguage: "She says 4,000 cheap homes disappeared since 2024.",
            attribution: "own_words",
            checkability: "easily_checkable",
            quote: "the city had lost 4,000 affordable units since 2024",
            quoteCharStart: 0,
            quoteCharEnd: 0,
          },
        ],
      }),
    )

    assert.deepEqual(
      items.map((i) => i.cardType),
      ["stance", "factual_claim"],
    )
    // The headline is whatever that kind's main text is.
    assert.equal(items[1].headline, "The city lost 4,000 affordable units since 2024.")
    assert.deepEqual(items[1].payload, {
      cardType: "factual_claim",
      checkability: "easily_checkable",
    })
  })

  test("an empty speaker name becomes null rather than an empty string", () => {
    const items = flattenExtraction(
      result({ stances: [{ ...STANCE, candidateName: "   " }] }),
    )

    assert.equal(items[0].candidateName, null)
  })
})

describe("extractInsights", () => {
  test("a verbatim quote verifies and gets real offsets", async () => {
    const document = doc()
    const run = await extractInsights(document, {
      client: stubClient(result({ stances: [STANCE] })),
    })

    assert.equal(run.error, undefined)
    assert.equal(run.verified.length, 1)

    const [item] = run.verified
    assert.equal(item.quoteVerified, "exact")
    assert.equal(
      document.rawText.slice(item.quoteCharStart, item.quoteCharEnd),
      STANCE.quote,
    )
  })

  test("a quote the document does not contain is rejected, not stored", async () => {
    const run = await extractInsights(doc(), {
      client: stubClient(
        result({
          stances: [{ ...STANCE, quote: "I will abolish the property tax entirely" }],
        }),
      ),
    })

    assert.equal(run.verified.length, 0)
    assert.equal(run.rejected.length, 1)
    assert.match(run.rejected[0].reason, /not found/)
  })

  test("the model's offset guess never overrides the measured one", async () => {
    const document = doc()
    // A confident, wrong guess. Verification has to win.
    const run = await extractInsights(document, {
      client: stubClient(
        result({ stances: [{ ...STANCE, quoteCharStart: 9999, quoteCharEnd: 10042 }] }),
      ),
    })

    const [item] = run.verified
    assert.equal(item.quoteCharStart, document.rawText.indexOf(STANCE.quote))
    assert.ok(item.hintDrift > 9000, "the drift from the guess is recorded")
  })

  test("a response that fails schema validation is an error, not a partial write", async () => {
    const run = await extractInsights(doc(), {
      client: stubClient({ stances: [{ topic: "not_a_real_topic" }] }),
    })

    assert.equal(run.verified.length, 0)
    assert.match(run.error ?? "", /failed validation/)
  })

  test("no tool call means nothing quotable, which is not an error", async () => {
    const run = await extractInsights(doc(), {
      client: stubClient(result(), {
        content: [{ type: "text", text: "Nothing here.", citations: [] }],
      }),
    })

    assert.equal(run.error, undefined)
    assert.equal(run.verified.length, 0)
  })

  test("a refusal is reported rather than swallowed", async () => {
    const run = await extractInsights(doc(), {
      client: stubClient(result(), { stop_reason: "refusal" }),
    })

    assert.match(run.error ?? "", /refused/)
  })

  test("a transport failure returns an error instead of throwing", async () => {
    const broken = {
      messages: {
        async create() {
          throw new Error("connection reset")
        },
      },
    } as unknown as Anthropic

    const run = await extractInsights(doc(), { client: broken })

    assert.equal(run.error, "connection reset")
    assert.equal(run.verified.length, 0)
  })
})

describe("verifyItems", () => {
  test("splits a batch into verified and rejected without losing any", () => {
    const document = doc()
    const items = flattenExtraction(
      result({
        stances: [STANCE, { ...STANCE, quote: "a quote that was never written here" }],
      }),
    )

    const { verified, rejected } = verifyItems(items, document)

    assert.equal(verified.length + rejected.length, items.length)
    assert.equal(verified.length, 1)
  })

  test("a near-miss quote is kept as fuzzy and corrected to the document's words", () => {
    const document = doc()
    const items = flattenExtraction(
      result({
        stances: [
          {
            ...STANCE,
            // Smart quotes folded AND a word dropped: past rungs 1 and 2.
            quote: "We will cap rent increases at three percent year",
          },
        ],
      }),
    )

    const { verified } = verifyItems(items, document)

    assert.equal(verified.length, 1)
    assert.equal(verified[0].quoteVerified, "fuzzy")
    assert.ok(verified[0].similarity >= 0.9 && verified[0].similarity < 1)
    // What gets stored points at the real sentence, not the model's version.
    assert.equal(
      document.rawText.slice(verified[0].quoteCharStart, verified[0].quoteCharEnd),
      STANCE.quote,
    )
  })

  test("fuzzy matching can be switched off per run", () => {
    const items = flattenExtraction(
      result({
        stances: [{ ...STANCE, quote: "We will cap rent increases at three percent year" }],
      }),
    )

    const { verified, rejected } = verifyItems(items, doc(), { allowFuzzy: false })

    assert.equal(verified.length, 0)
    assert.equal(rejected.length, 1)
  })
})
