import { strict as assert } from "node:assert"
import { test } from "node:test"
import { displayName, initials } from "./name"

test("leaves a name that already carries case alone", () => {
  assert.equal(displayName("Xavier Becerra"), "Xavier Becerra")
  assert.equal(displayName("Ro Khanna"), "Ro Khanna")
  // Even where our rules would have chosen differently, the state's spelling wins.
  assert.equal(displayName("Kamala D. harris"), "Kamala D. harris")
})

test("title-cases a shouted name", () => {
  assert.equal(displayName("PATRICK FALLON"), "Patrick Fallon")
  assert.equal(displayName("ANDREW LEE RUBELL"), "Andrew Lee Rubell")
})

test("keeps the punctuation inside real names", () => {
  assert.equal(displayName("SHEILA O'BRIEN"), "Sheila O'Brien")
  assert.equal(displayName("MARY-JANE SMITH-JONES"), "Mary-Jane Smith-Jones")
  assert.equal(displayName("SEAN MCDONALD"), "Sean McDonald")
})

test("keeps suffixes uppercase, but not as a first name", () => {
  assert.equal(displayName("HENRY CUELLAR JR"), "Henry Cuellar JR")
  assert.equal(displayName("JOHN SMITH III"), "John Smith III")
})

test("lowercases particles inside a name", () => {
  assert.equal(displayName("JUAN DE LA CRUZ"), "Juan de la Cruz")
})

test("normalises whitespace", () => {
  assert.equal(displayName("  WESLEY   HUNT  "), "Wesley Hunt")
})

test("initials take the first two words", () => {
  assert.equal(initials("PATRICK FALLON"), "PF")
  assert.equal(initials("Xavier Becerra"), "XB")
  assert.equal(initials("Ro"), "R")
})
