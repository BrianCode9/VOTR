import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { collapseByQuote, dedupeVerified } from "./dedup"
import { relevanceScore } from "./relevance"
import { decodeCursor, encodeCursor } from "../queries/feed"
import type { CardType, VerifiedItem } from "../schemas/insight"

/**
 * A verified stance, with the fields a test cares about overridable.
 *
 * Callers that change `cardType` pass the matching `payload` too: the two are
 * a discriminated pair everywhere else in the system, and a helper that
 * silently fixed up a mismatch would hide exactly the bug worth catching.
 */
function item(overrides: Partial<VerifiedItem> = {}): VerifiedItem {
  return {
    cardType: "stance",
    topic: "housing",
    topics: ["housing"],
    candidateName: "Jane Doe",
    headline: "Supports the rent cap",
    plainLanguage: "She wants to limit rent increases.",
    attribution: "own_words",
    confidence: 0.9,
    claimSupportConfidence: 0.9,
    quote: "we will cap rent increases",
    quoteHint: { start: 0, end: 0 },
    payload: { cardType: "stance" },
    quoteCharStart: 100,
    quoteCharEnd: 140,
    quoteVerified: "exact",
    similarity: 1,
    occurrences: 1,
    hintDrift: 0,
    ...overrides,
  }
}

describe("dedupeVerified", () => {
  test("the same kind on the same span is stored once", () => {
    const { kept, dropped } = dedupeVerified([
      item({ confidence: 0.6 }),
      item({ confidence: 0.95, headline: "Backs the rent cap" }),
    ])

    assert.equal(kept.length, 1)
    assert.equal(dropped.length, 1)
    // The better-scoring one survives, not whichever came first.
    assert.equal(kept[0].headline, "Backs the rent cap")
  })

  test("different kinds on the same span are all kept", () => {
    // They are different insights that happen to share evidence. Collapsing
    // them is the feed's job, at read time, so that none is lost.
    const { kept } = dedupeVerified([
      item({ cardType: "stance" }),
      item({ cardType: "factual_claim", payload: { cardType: "factual_claim", checkability: "easily_checkable" } }),
    ])

    assert.equal(kept.length, 2)
  })

  test("a quote nested inside a kept one on the same topic is dropped", () => {
    const { kept, dropped } = dedupeVerified([
      item({ quoteCharStart: 100, quoteCharEnd: 200 }),
      item({ quoteCharStart: 120, quoteCharEnd: 160 }),
    ])

    assert.equal(kept.length, 1)
    // The longer span survives: it is the one that still reads on its own.
    assert.deepEqual([kept[0].quoteCharStart, kept[0].quoteCharEnd], [100, 200])
    assert.match(dropped[0].reason, /sits inside/)
  })

  test("a nested quote on a different topic is kept", () => {
    const { kept } = dedupeVerified([
      item({ quoteCharStart: 100, quoteCharEnd: 200, topic: "housing" }),
      item({ quoteCharStart: 120, quoteCharEnd: 160, topic: "climate" }),
    ])

    assert.equal(kept.length, 2)
  })

  test("overlapping but non-nested spans are both kept", () => {
    const { kept } = dedupeVerified([
      item({ quoteCharStart: 100, quoteCharEnd: 200 }),
      item({ quoteCharStart: 150, quoteCharEnd: 260 }),
    ])

    assert.equal(kept.length, 2)
  })

  test("survivors come back in document order", () => {
    const { kept } = dedupeVerified([
      item({ quoteCharStart: 500, quoteCharEnd: 540, topic: "climate" }),
      item({ quoteCharStart: 100, quoteCharEnd: 140, topic: "housing" }),
      item({ quoteCharStart: 300, quoteCharEnd: 340, topic: "guns" }),
    ])

    assert.deepEqual(
      kept.map((k) => k.quoteCharStart),
      [100, 300, 500],
    )
  })
})

describe("collapseByQuote", () => {
  const row = (
    id: string,
    cardType: CardType,
    start: number,
    relevance = 0.5,
    documentId = "doc-1",
  ) => ({ id, cardType, documentId, quoteCharStart: start, quoteCharEnd: start + 40, relevanceScore: relevance })

  test("cards on the same quote collapse to the most informative kind", () => {
    const groups = collapseByQuote([
      row("a", "stance", 100, 0.99),
      row("b", "stance_change", 100, 0.1),
      row("c", "factual_claim", 100, 0.8),
    ])

    assert.equal(groups.length, 1)
    // Priority beats score: the flip-flop is the better framing of the same
    // evidence even when the stance scored higher.
    assert.equal(groups[0].row.id, "b")
    assert.equal(groups[0].collapsed.length, 2)
  })

  test("the same span in different documents does not collapse", () => {
    const groups = collapseByQuote([
      row("a", "stance", 100, 0.5, "doc-1"),
      row("b", "stance", 100, 0.5, "doc-2"),
    ])

    assert.equal(groups.length, 2)
  })

  test("different spans in one document do not collapse", () => {
    const groups = collapseByQuote([row("a", "stance", 100), row("b", "stance", 300)])

    assert.equal(groups.length, 2)
  })
})

describe("relevanceScore", () => {
  test("a stance change outranks a stance on identical evidence", () => {
    const stance = item({ cardType: "stance" })
    const change = item({
      cardType: "stance_change",
      payload: { cardType: "stance_change", previousPosition: "opposed it", priorInsightId: null },
    })

    assert.ok(relevanceScore(change) > relevanceScore(stance))
  })

  test("a fuzzy quote ranks below the same card matched exactly", () => {
    const exact = item({ quoteVerified: "exact" })
    const fuzzy = item({ quoteVerified: "fuzzy", similarity: 0.93 })

    assert.ok(relevanceScore(fuzzy) < relevanceScore(exact))
  })

  test("an ambiguous quote is penalised", () => {
    assert.ok(relevanceScore(item({ occurrences: 3 })) < relevanceScore(item()))
  })

  test("every score stays within (0, 1]", () => {
    for (const confidence of [0, 0.5, 1]) {
      const score = relevanceScore(item({ cardType: "stance_change", confidence, payload: { cardType: "stance_change", previousPosition: "x", priorInsightId: null } }))
      assert.ok(score > 0 && score <= 1, `score ${score} out of range`)
    }
  })
})

describe("feed cursors", () => {
  test("a cursor round-trips", () => {
    const cursor = { s: "relevant" as const, r: 0.625, t: "2026-09-19T12:00:00.000Z", id: "abc" }

    assert.deepEqual(decodeCursor(encodeCursor(cursor), "relevant"), cursor)
  })

  test("a cursor from another sort order is ignored", () => {
    const cursor = encodeCursor({ s: "recent", t: "2026-09-19T12:00:00.000Z", id: "abc" })

    // Honouring it would page into a sequence that no longer exists.
    assert.equal(decodeCursor(cursor, "relevant"), null)
  })

  test("a malformed cursor restarts the feed instead of throwing", () => {
    assert.equal(decodeCursor("not-base64-at-all!!", "recent"), null)
    assert.equal(decodeCursor(Buffer.from("[]").toString("base64url"), "recent"), null)
    assert.equal(decodeCursor(null, "recent"), null)
  })
})
