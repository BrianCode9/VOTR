import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  FEATURED_POLITICAL_FIGURES,
  getFeaturedPoliticalFigure,
  searchFeaturedPoliticalFigures,
} from "./featured"

describe("featured political figures", () => {
  test("contains exactly 100 unique starter profiles", () => {
    assert.equal(FEATURED_POLITICAL_FIGURES.length, 100)
    assert.equal(new Set(FEATURED_POLITICAL_FIGURES.map((person) => person.slug)).size, 100)
  })

  test("finds Donald Trump despite a one-letter typo", () => {
    assert.equal(searchFeaturedPoliticalFigures("donal trump")[0]?.slug, "donald-trump")
  })

  test("supports common initials and aliases", () => {
    assert.equal(searchFeaturedPoliticalFigures("AOC")[0]?.slug, "alexandria-ocasio-cortez")
    assert.equal(searchFeaturedPoliticalFigures("RFK Jr")[0]?.slug, "robert-f-kennedy-jr")
  })

  test("looks up a stable profile slug", () => {
    assert.equal(getFeaturedPoliticalFigure("bernie-sanders")?.name, "Bernie Sanders")
  })
})
