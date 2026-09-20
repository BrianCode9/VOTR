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

test("cases suffixes by kind, but never as a first name", () => {
  // A Roman numeral is uppercase; an abbreviated word is not.
  assert.equal(displayName("HENRY CUELLAR JR"), "Henry Cuellar Jr.")
  assert.equal(displayName("SAMUEL B. GRAVES JR."), "Samuel B. Graves Jr.")
  assert.equal(displayName("TROY A. CARTER SR."), "Troy A. Carter Sr.")
  assert.equal(displayName("JOHN SMITH III"), "John Smith III")
  assert.equal(displayName("DAMON LYNCH IV"), "Damon Lynch IV")
  // A single letter with a period is an initial, not a numeral.
  assert.equal(displayName("WILLIAM V. HILLEARY"), "William V. Hilleary")
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
