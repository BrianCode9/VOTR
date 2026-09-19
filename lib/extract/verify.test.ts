import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { verifyQuote } from "./verify"
import { boundedLevenshtein, similarity } from "./fuzzy"
import type { NormalizedDocument } from "../adapters/types"

function article(rawText: string): NormalizedDocument {
  return {
    id: "00000000-0000-5000-8000-000000000000",
    sourceUrl: "https://example.test/a",
    sourceType: "rss",
    sourceName: "Example",
    title: "Example",
    publishedAt: null,
    fetchedAt: new Date("2026-01-01T00:00:00Z"),
    rawText,
    mediaType: "article",
    isSynthetic: false,
    rawMetadata: {},
  }
}

function transcript(rawText: string): NormalizedDocument {
  return { ...article(rawText), mediaType: "transcript" }
}

/**
 * The property that matters everywhere: whatever offsets come back, slicing the
 * ORIGINAL rawText with them must return the real span. Every passing case
 * asserts this, because offsets computed against a normalized copy satisfy a
 * naive "did it match" assertion while pointing at the wrong characters.
 */
function assertSpan(
  doc: NormalizedDocument,
  result: ReturnType<typeof verifyQuote>,
  expected: string,
) {
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
    const quote = "I think we should fund the bridge"

    // Rung 3 is transcript-only, so this cannot match losslessly...
    assert.equal(verifyQuote(quote, doc, { allowFuzzy: false }).ok, false)

    // ...but rung 4 finds it, and the span it returns is the real text,
    // filler included. The card renders "uh" because the article says "uh".
    const result = verifyQuote(quote, doc)
    assert.equal(result.ok && result.rung, "fuzzy")
    assertSpan(doc, result, "I think we should uh fund the bridge")
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

  /**
   * Rung 4. The one rung that is allowed to be wrong, and therefore the one
   * with the most to prove: it must correct the quote rather than accept it,
   * it must return offsets into the original, and it must refuse anything it
   * cannot place with confidence.
   */
  describe("the fuzzy rung", () => {
    test("a dropped comma is located and the stored span keeps the comma", () => {
      const prefix = "At the hearing the mayor said "
      const target = "we will fund the bridge, the tunnel, and the busway this year"
      const doc = article(prefix + target + " and sat down.")

      // What a model actually does: tidies the punctuation away.
      const result = verifyQuote(
        "we will fund the bridge the tunnel and the busway this year",
        doc,
      )

      assert.equal(result.ok && result.rung, "fuzzy")
      // The corrected quote is the document's, commas and all.
      assertSpan(doc, result, target)
      assert.equal(result.ok && result.start, prefix.length)
      assert.ok(result.ok && result.similarity >= 0.9)
      assert.ok(result.ok && result.similarity < 1, "a fuzzy match is not a perfect one")
    })

    test("one substituted word still resolves to the document's words", () => {
      const target = "the council approved the measure without a public hearing"
      const doc = article(`Records show ${target}, minutes confirm.`)

      // "a" became "any": close enough to locate, and the span must still be
      // what the document says, not what the model wrote.
      const result = verifyQuote(
        "the council approved the measure without any public hearing",
        doc,
      )

      assert.equal(result.ok && result.rung, "fuzzy")
      assertSpan(doc, result, target)
    })

    test("offsets index the original after entity and quote normalization", () => {
      // The fuzzy rung runs on normalized text, where &amp; is one character
      // and the original is five. Returning a normalized index here is the
      // same class of bug rung 2 has to avoid, and it has to be avoided again.
      const prefix = "Filed Tuesday. Roads &amp; rail &amp; transit: "
      const target = "“we fund every mile of it before the next winter arrives”"
      const doc = article(prefix + target + " the memo reads.")

      const result = verifyQuote(
        '"we fund every mile of it before next winter arrives"',
        doc,
      )

      assert.equal(result.ok && result.rung, "fuzzy")
      assert.equal(result.ok && result.start, prefix.length)
      assertSpan(doc, result, target)
    })

    test("a paraphrase stays below the threshold and is refused", () => {
      const doc = article(
        "We will fund the bridge this year, the mayor said at the hearing on Tuesday.",
      )

      // Same meaning, rewritten. This is the failure mode the whole module
      // exists for, and 0.9 must not let it through.
      const result = verifyQuote("The bridge is going to get funded sometime this year", doc)

      assert.equal(result.ok, false)
    })

    test("a short quote is never fuzzy matched", () => {
      // At 0.9 a twenty character needle may differ by two characters, which is
      // enough to invert a meaning. Short quotes match losslessly or not at all.
      const doc = article("The senator said she will not vote for the bill on Thursday.")

      const result = verifyQuote("she will now vote", doc)

      assert.equal(result.ok, false)
    })

    test("a quote with no distinctive words anchors nothing and is refused", () => {
      const doc = article(
        "It is what it is and that is all there is to it, the spokesman said again.",
      )

      const result = verifyQuote("it is what it is and that is all it is to be", doc)

      assert.equal(result.ok, false)
    })

    test("allowFuzzy: false keeps the ladder lossless", () => {
      const doc = article("We will fund the bridge, the tunnel, and the busway this year.")
      const quote = "We will fund the bridge the tunnel and the busway this year"

      assert.equal(verifyQuote(quote, doc, { allowFuzzy: false }).ok, false)
      assert.equal(verifyQuote(quote, doc).ok, true)
    })

    test("a stricter threshold refuses what 0.9 accepts", () => {
      const doc = article("We will fund the bridge, the tunnel, and the busway this year.")
      const quote = "we will fund the bridge the tunnel and the busway this year"

      assert.equal(verifyQuote(quote, doc, { fuzzyThreshold: 0.9 }).ok, true)
      assert.equal(verifyQuote(quote, doc, { fuzzyThreshold: 0.995 }).ok, false)
    })

    test("an exact match never reports itself as fuzzy", () => {
      const doc = article("She said we will fund the bridge before the next winter.")

      const result = verifyQuote("we will fund the bridge before the next winter", doc)

      assert.equal(result.ok && result.rung, "exact")
      assert.equal(result.ok && result.similarity, 1)
    })
  })

  describe("the similarity measure itself", () => {
    test("identical strings score 1 and disjoint ones score low", () => {
      assert.equal(similarity("fund the bridge", "fund the bridge"), 1)
      assert.ok(similarity("fund the bridge", "abolish the county") < 0.5)
    })

    test("one edit in ten characters lands just under 0.9", () => {
      // The threshold is defined against this ratio, so it is worth pinning.
      assert.equal(similarity("abcdefghij", "abcdefghix"), 0.9)
      assert.ok(similarity("abcdefghij", "abcdefghxx") < 0.9)
    })

    test("bounded distance abandons the search past its budget", () => {
      assert.equal(boundedLevenshtein("kitten", "sitting", 10), 3)
      // Over budget returns budget + 1 rather than the true distance.
      assert.equal(boundedLevenshtein("kitten", "sitting", 1), 2)
      assert.equal(boundedLevenshtein("same", "same", 0), 0)
    })
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
