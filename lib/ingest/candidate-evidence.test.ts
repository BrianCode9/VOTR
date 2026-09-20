import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { evidenceText, exactSpan, validateEvidence } from "./candidate-evidence"

const page = { sourceKey: "fec:2026:H6PA01181", url: "https://example.org/issues", kind: "campaign", rawText: "Priorities: Support rural hospitals and protect Medicare." }
const evidence = { sourceKey: page.sourceKey, url: page.url, sha256: createHash("sha256").update(page.rawText).digest("hex"), claims: [{ issueTag: "healthcare", quote: "Support rural hospitals", positionText: "Supports rural hospitals." }] }
test("rejects a quote assigned to another candidate or changed source", () => {
  assert.throws(() => validateEvidence({ ...evidence, sourceKey: "someone-else" }, page), /identity/)
  assert.throws(() => validateEvidence(evidence, { ...page, rawText: page.rawText + " Changed." }), /changed/)
})
test("fails closed for missing or duplicated passages", () => {
  assert.throws(() => exactSpan(page.rawText, "Opposes Medicare"), /missing/)
  assert.throws(() => exactSpan("Support hospitals. Support hospitals.", "Support hospitals."), /ambiguous/)
})
test("new source normalization makes JS and SQL offsets agree after emoji", () => {
  const text = evidenceText("🇺🇸 Priorities: Support hospitals.")
  const span = exactSpan(text, "Support hospitals.")
  assert.equal(text.slice(span.start, span.end), "Support hospitals.")
  assert.equal([...text].slice(span.start, span.end).join(""), "Support hospitals.")
})
test("checks issue vocabulary and campaign excerpt limit", () => {
  assert.throws(() => validateEvidence({ ...evidence, claims: [{ ...evidence.claims[0], issueTag: "invented" }] }, page))
  const text = Array.from({ length: 26 }, (_, i) => `word${i}`).join(" ")
  const longPage = { ...page, rawText: text }
  assert.throws(() => validateEvidence({ ...evidence, sha256: createHash("sha256").update(text).digest("hex"), claims: [{ ...evidence.claims[0], quote: text }] }, longPage), /budget/)
  assert.equal(validateEvidence(evidence, page).claims[0].start, 12)
})
