import assert from "node:assert/strict"
import test from "node:test"
import { lookupTitle, normalizeTitle, politicsAndState, requestedKey, usableLicense } from "./import-candidate-photos.mjs"

test("normalizes equivalent Wikipedia titles without dropping name characters", () => {
  assert.equal(normalizeTitle("José A. García"), "jose a garcia")
  assert.equal(normalizeTitle("JOSE_A_GARCIA"), "jose a garcia")
})

test("accepts public domain and attribution licenses", () => {
  for (const license of ["Public domain", "PD-USGov", "CC0", "CC BY 4.0", "CC BY-SA 3.0"]) {
    assert.equal(usableLicense(license), true, license)
  }
})

test("rejects noncommercial, no-derivatives, and unknown image terms", () => {
  for (const license of ["CC BY-NC 4.0", "CC BY-ND 4.0", "Fair use", "", undefined]) {
    assert.equal(usableLicense(license), false, String(license))
  }
})

test("requires a political biography and state context", () => {
  const michiganCandidate = { state: "MI" }
  assert.equal(
    politicsAndState(michiganCandidate, {
      description: "Governor of Michigan",
      extract: "An American politician serving as governor of Michigan.",
    }),
    true,
  )
  assert.equal(
    politicsAndState(michiganCandidate, {
      description: "Governor of Wisconsin",
      extract: "An American politician serving as governor of Wisconsin.",
    }),
    false,
  )
  assert.equal(
    politicsAndState(michiganCandidate, {
      description: "American actor",
      extract: "An actor born in Michigan.",
    }),
    false,
  )
})

test("an FEC id resolves an exact title the name could never produce", () => {
  // The filing spells a legal name; the article is under a nickname with a
  // disambiguator. Guessing from the name cannot reach it.
  assert.deepEqual(lookupTitle({ name: "ERIC ALAN RICK CRAWFORD", wikiTitle: "Rick Crawford (politician)" }),
    { title: "Rick Crawford (politician)", verified: true })
  // Without one, the name is cased into a plausible title as before.
  assert.deepEqual(lookupTitle({ name: "WESLEY HUNT", wikiTitle: null }),
    { title: "Wesley Hunt", verified: false })
})

test("a page is found under the title the batch asked for", () => {
  // MediaWiki answers under the title it resolved to. An exact title from the
  // legislator dataset is often a redirect, and a chain of both rewrites has
  // to walk all the way back or the page is dropped.
  const alias = new Map([
    ["steve womack", "stephen womack"],
    ["stephen womack", "stephen a womack"],
  ])
  assert.equal(requestedKey("Steve Womack", alias), "stephen a womack")
  // A title nothing rewrote is its own key.
  assert.equal(requestedKey("Paul Gosar", new Map()), "paul gosar")
  // A cycle cannot hang the walk.
  assert.equal(requestedKey("A", new Map([["a", "b"], ["b", "a"]])), "a")
})
