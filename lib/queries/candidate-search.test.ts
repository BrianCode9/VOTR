import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { normalizeCandidateSearch } from "./candidate-search"

describe("normalizeCandidateSearch", () => {
  test("trims and collapses whitespace", () => {
    assert.equal(normalizeCandidateSearch("  Mary   Jane\tWatson  "), "Mary Jane Watson")
  })

  test("bounds the query length", () => {
    assert.equal(normalizeCandidateSearch("a".repeat(100)).length, 80)
  })

  test("preserves punctuation used in names", () => {
    assert.equal(normalizeCandidateSearch("O'Brien-Smith"), "O'Brien-Smith")
  })
})
