import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  CONFIDENCE_LABELS,
  DEFAULT_CONFIDENCE_THRESHOLDS,
  confidenceFields,
  confidenceLabel,
  confidenceThresholdsFromEnv,
  isConfidenceLabel,
  isPresentationMode,
  presentationMode,
  verifyYourself,
} from "./score"

/**
 * The threshold branching, exhaustively.
 *
 * Every function here is pure, so every branch is reachable from a literal.
 * What these tests are actually protecting is the boundary behaviour: the
 * difference between `>=` and `>` at 0.5 decides whether a card is presented
 * as something a person said or as something to go and check, and that is not
 * a distinction to leave to whoever edits the file next.
 */

describe("confidenceLabel", () => {
  test("the default cut points", () => {
    assert.equal(confidenceLabel(1), "high")
    assert.equal(confidenceLabel(0.9), "high")
    assert.equal(confidenceLabel(0.7), "medium")
    assert.equal(confidenceLabel(0.49), "low")
    assert.equal(confidenceLabel(0), "low")
  })

  test("the boundaries are inclusive at the bottom of each band", () => {
    // 0.8 is high, not medium. 0.5 is medium, not low. Both of these flip if
    // someone changes >= to >, and only the second one changes a card's
    // wording, which is why it gets its own assertion below too.
    assert.equal(confidenceLabel(DEFAULT_CONFIDENCE_THRESHOLDS.high), "high")
    assert.equal(confidenceLabel(DEFAULT_CONFIDENCE_THRESHOLDS.medium), "medium")
    assert.equal(confidenceLabel(0.7999), "medium")
    assert.equal(confidenceLabel(0.4999), "low")
  })

  test("exactly 0.5 is not a verify-yourself card", () => {
    assert.equal(verifyYourself(confidenceLabel(0.5)), false)
    assert.equal(verifyYourself(confidenceLabel(0.4999)), true)
  })

  test("an unrated insight is low, not medium", () => {
    // The honest default. An insight nothing rated is exactly the case the
    // nudge exists for, and landing it in the middle band would present an
    // unrated inference as a stated fact.
    assert.equal(confidenceLabel(null), "low")
    assert.equal(confidenceLabel(undefined), "low")
    assert.equal(confidenceLabel(Number.NaN), "low")
    assert.equal(confidenceLabel(Number.POSITIVE_INFINITY), "low")
  })

  test("custom thresholds move the bands", () => {
    const strict = { high: 0.95, medium: 0.8 }
    assert.equal(confidenceLabel(0.9, strict), "medium")
    assert.equal(confidenceLabel(0.79, strict), "low")
    assert.equal(confidenceLabel(0.95, strict), "high")
  })
})

describe("verifyYourself and presentationMode", () => {
  test("low, and only low, asks the reader to check", () => {
    assert.equal(verifyYourself("low"), true)
    assert.equal(verifyYourself("medium"), false)
    assert.equal(verifyYourself("high"), false)
  })

  test("the mode follows the flag, for every label", () => {
    for (const label of CONFIDENCE_LABELS) {
      assert.equal(
        presentationMode(label) === "nudge_verify",
        verifyYourself(label),
        `${label} must not be flagged one way and presented the other`,
      )
    }
  })
})

describe("confidenceFields", () => {
  test("the four values always agree with each other", () => {
    for (const score of [0, 0.25, 0.4999, 0.5, 0.7, 0.8, 0.99, 1]) {
      const fields = confidenceFields(score)
      assert.equal(fields.confidenceLabel, confidenceLabel(score))
      assert.equal(fields.verifyYourself, fields.confidenceLabel === "low")
      assert.equal(
        fields.presentationMode,
        fields.verifyYourself ? "nudge_verify" : "stated",
      )
    }
  })

  test("a score outside 0..1 is clamped rather than stored raw", () => {
    assert.equal(confidenceFields(1.4).claimSupportConfidence, 1)
    assert.equal(confidenceFields(-0.2).claimSupportConfidence, 0)
    // Clamping does not change the label: 1.4 was already above every cut.
    assert.equal(confidenceFields(1.4).confidenceLabel, "high")
    assert.equal(confidenceFields(-0.2).confidenceLabel, "low")
  })

  test("a null score stores null and still produces a usable card state", () => {
    const fields = confidenceFields(null)
    assert.equal(fields.claimSupportConfidence, null)
    assert.equal(fields.confidenceLabel, "low")
    assert.equal(fields.presentationMode, "nudge_verify")
  })
})

describe("confidenceThresholdsFromEnv", () => {
  test("nothing set means the defaults", () => {
    assert.deepEqual(confidenceThresholdsFromEnv({}), DEFAULT_CONFIDENCE_THRESHOLDS)
  })

  test("a present but empty value does not become zero", () => {
    // Number("") is 0, and a threshold of 0 would label every insight `high`.
    // This is the same trap flagOptionsFromEnv guards against.
    assert.deepEqual(
      confidenceThresholdsFromEnv({
        CONFIDENCE_HIGH_THRESHOLD: "",
        CONFIDENCE_MEDIUM_THRESHOLD: "   ",
      }),
      DEFAULT_CONFIDENCE_THRESHOLDS,
    )
  })

  test("values outside 0..1 and non-numbers fall back", () => {
    assert.equal(confidenceThresholdsFromEnv({ CONFIDENCE_HIGH_THRESHOLD: "7" }).high, 0.8)
    assert.equal(confidenceThresholdsFromEnv({ CONFIDENCE_HIGH_THRESHOLD: "-1" }).high, 0.8)
    assert.equal(confidenceThresholdsFromEnv({ CONFIDENCE_HIGH_THRESHOLD: "high" }).high, 0.8)
  })

  test("valid values are applied", () => {
    assert.deepEqual(
      confidenceThresholdsFromEnv({
        CONFIDENCE_HIGH_THRESHOLD: "0.9",
        CONFIDENCE_MEDIUM_THRESHOLD: "0.6",
      }),
      { high: 0.9, medium: 0.6 },
    )
  })

  test("an inverted pair is rejected as a pair, not half-applied", () => {
    // medium above high would make the medium band empty and the low band
    // swallow scores that should be high. Taking one of the two would be
    // worse than taking neither.
    assert.deepEqual(
      confidenceThresholdsFromEnv({
        CONFIDENCE_HIGH_THRESHOLD: "0.4",
        CONFIDENCE_MEDIUM_THRESHOLD: "0.9",
      }),
      DEFAULT_CONFIDENCE_THRESHOLDS,
    )
  })
})

describe("enum guards", () => {
  test("only the real values pass", () => {
    assert.equal(isConfidenceLabel("high"), true)
    assert.equal(isConfidenceLabel("HIGH"), false)
    assert.equal(isConfidenceLabel("verify"), false)
    assert.equal(isPresentationMode("nudge_verify"), true)
    assert.equal(isPresentationMode("stated"), true)
    assert.equal(isPresentationMode("verify_yourself"), false)
  })
})
