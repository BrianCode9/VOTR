import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { verifyQuote } from "./verify"
import type { Document } from "../adapters/types"

function article(rawText: string): Document {
  return {
    url: "https://example.test/a",
    sourceType: "rss",
    sourceName: "Example",
    title: "Example",
    publishedAt: null,
    rawText,
    mediaType: "article",
    isSynthetic: false,
  }
}

function transcript(rawText: string): Document {
  return { ...article(rawText), mediaType: "transcript" }
}

/**
 * The property that matters everywhere: whatever offsets come back, slicing the
 * ORIGINAL rawText with them must return the real span. Every passing case
 * asserts this, because offsets computed against a normalized copy satisfy a
 * naive "did it match" assertion while pointing at the wrong characters.
 */
function assertSpan(doc: Document, result: ReturnType<typeof verifyQuote>, expected: string) {
  assert.equal(result.ok, true, `expected a match, got: ${JSON.stringify(result)}`)
  if (!result.ok) return
  const sliced = doc.rawText.slice(result.start, result.end)
  assert.equal(
    sliced,
    expected,
    `offsets ${result.start}..${result.end} sliced "${sliced}" but the original span is "${expected}"`,
  )
}

describe("verifyQuote", () => {
  test("exact match returns offsets that slice the original", () => {
    const doc = article("The mayor said we will fund the bridge this year. Then she left.")
    const quote = "we will fund the bridge this year"

    const result = verifyQuote(quote, doc)

    assert.equal(result.ok && result.rung, "exact")
    assertSpan(doc, result, quote)
  })

  test("curly quotes in the source, straight quotes in the candidate", () => {
    const doc = article('She said “we will fund the bridge” at the hearing.')
    const quote = '"we will fund the bridge"'

    const result = verifyQuote(quote, doc)

    assert.equal(result.ok && result.rung, "normalized")
    // The returned span must be the CURLY original, not the straight candidate.
    assertSpan(doc, result, '“we will fund the bridge”')
  })

  test("HTML entity in the source", () => {
    const doc = article("Funding for roads &amp; bridges passed on Tuesday.")
    const quote = "roads & bridges passed"

    const result = verifyQuote(quote, doc)

    assert.equal(result.ok && result.rung, "normalized")
    // Five original characters produced one normalized one. The end offset has
    // to cover all five or the span truncates mid-entity.
    assertSpan(doc, result, "roads &amp; bridges passed")
  })

  test("collapsed whitespace and a line break inside the quote", () => {
    const doc = article("He argued that the\n   proposal   was\trushed and costly.")
    const quote = "the proposal was rushed"

    const result = verifyQuote(quote, doc)

    assert.equal(result.ok && result.rung, "normalized")
    assertSpan(doc, result, "the\n   proposal   was\trushed")
  })

  test("em dash in the source, hyphen in the candidate", () => {
    const doc = article("The plan — which failed twice — returns in March.")
    const quote = "The plan - which failed twice - returns"

    const result = verifyQuote(quote, doc)

    assertSpan(doc, result, "The plan — which failed twice — returns")
  })

  test("a transcript with filler words", () => {
    const doc = transcript(
      "So um I think we should uh fund the bridge, you know, before winter.",
    )
    const quote = "I think we should fund the bridge"

    const result = verifyQuote(quote, doc)

    assert.equal(result.ok && result.rung, "transcript")
    // The span spans the filler, because the filler is really there.
    assertSpan(doc, result, "I think we should uh fund the bridge")
  })

  test("a transcript with a single-word stutter repeat", () => {
    const doc = transcript("We will fund the the bridge next spring.")
    const quote = "We will fund the bridge"

    const result = verifyQuote(quote, doc)

    assert.equal(result.ok && result.rung, "transcript")
    assertSpan(doc, result, "We will fund the the bridge")
  })

  test("a repeated PHRASE is not collapsed, and must fail", () => {
    // The ladder collapses repeated words, not repeated phrases. "we will we
    // will" is a real stutter that this deliberately does not match, because
    // collapsing phrases risks stitching together words the speaker never said
    // contiguously. Failing here is the correct, conservative outcome.
    const doc = transcript("We will we will fund the bridge next spring.")

    const result = verifyQuote("We will fund the bridge", doc)

    assert.equal(result.ok, false)
  })

  test("filler stripping does not apply to articles", () => {
    const doc = article("So um I think we should uh fund the bridge.")

    const result = verifyQuote("I think we should fund the bridge", doc)

    assert.equal(result.ok, false)
  })

  test("a quote that genuinely is not present must fail", () => {
    const doc = article("The mayor discussed transit funding at the hearing.")

    const result = verifyQuote("I will never raise taxes", doc)

    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.reason, /not found/)
  })

  test("a paraphrase must fail rather than match loosely", () => {
    const doc = article("We will fund the bridge this year, the mayor said.")

    // Same meaning, different words. This is exactly what the model does wrong.
    const result = verifyQuote("The bridge will be funded this year", doc)

    assert.equal(result.ok, false)
  })

  test("an empty quote fails", () => {
    assert.equal(verifyQuote("   ", article("anything at all here")).ok, false)
  })

  test("reports ambiguity when the quote appears more than once", () => {
    const doc = article("fund the bridge. Later: fund the bridge.")

    const result = verifyQuote("fund the bridge", doc)

    assert.equal(result.ok && result.occurrences, 2)
    assertSpan(doc, result, "fund the bridge")
  })

  describe("the offset integrity property", () => {
    /**
     * THE CRITICAL ONE from the kickoff.
     *
     * Every normalization here shortens the text before the quote, so the
     * normalized match index is numerically different from the true offset.
     * An implementation that returns the normalized index passes a "did we
     * match" assertion and fails this.
     */
    test("offsets index the original after heavy normalization", () => {
      const prefix = "Reporters &amp; editors asked\n\n   repeatedly — twice — about it. "
      const target = "We’re going to “fund the bridge”  this year"
      const suffix = " she added, &quot;finally.&quot;"
      const doc = article(prefix + target + suffix)

      const quote = `We're going to "fund the bridge" this year`
      const result = verifyQuote(quote, doc)

      assert.equal(result.ok, true)
      if (!result.ok) return

      // The span is the original, curly quotes and double space intact.
      assert.equal(doc.rawText.slice(result.start, result.end), target)

      // And it starts exactly where the target was placed, which is what a
      // normalized-index bug gets wrong.
      assert.equal(result.start, prefix.length)
      assert.equal(result.end, prefix.length + target.length)
    })

    test("a quote ending on an entity covers the whole entity", () => {
      const doc = article("The vote covered roads &amp; rail &amp; transit today.")

      const result = verifyQuote("roads & rail & transit", doc)

      assert.equal(result.ok, true)
      if (!result.ok) return
      const sliced = doc.rawText.slice(result.start, result.end)
      assert.equal(sliced, "roads &amp; rail &amp; transit")
      // Not truncated mid-entity.
      assert.ok(!sliced.endsWith("&am"), "end offset truncated inside an entity")
    })

    test("a quote starting immediately after an entity is not shifted", () => {
      const doc = article("Roads &amp; bridges: the council approved the measure.")
      const target = "the council approved the measure"

      const result = verifyQuote(target, doc)

      assertSpan(doc, result, target)
      assert.equal(result.ok && result.start, doc.rawText.indexOf(target))
    })

    test("transcript offsets survive filler removal at the span edges", () => {
      const prefix = "Interviewer: and the bridge? Candidate: um "
      const target = "we fund it uh this year"
      const doc = transcript(prefix + target + " um okay.")

      const result = verifyQuote("we fund it this year", doc)

      assert.equal(result.ok, true)
      if (!result.ok) return
      assert.equal(doc.rawText.slice(result.start, result.end), target)
      assert.equal(result.start, prefix.length)
    })
  })
})
