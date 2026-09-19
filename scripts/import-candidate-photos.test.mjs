import assert from "node:assert/strict"
import test from "node:test"
import { normalizeTitle, politicsAndState, usableLicense } from "./import-candidate-photos.mjs"

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
