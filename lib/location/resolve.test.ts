import { strict as assert } from "node:assert"
import { test } from "node:test"
import { parseDistrictCode } from "./resolve"
import { congressionalGeoId } from "./resolve"

test("reads an ordinary district from a GEOID", () => {
  assert.equal(parseDistrictCode("4807"), "7")
  assert.equal(parseDistrictCode("2403"), "3")
  assert.equal(parseDistrictCode("4838"), "38")
})

test("reads a bare CD field", () => {
  assert.equal(parseDistrictCode("07"), "7")
  assert.equal(parseDistrictCode("38"), "38")
})

test("at-large states are district 0, matching how they were imported", () => {
  // Wyoming: GEOID 5600. districts.geo_id holds US-WY-congressional-0.
  assert.equal(parseDistrictCode("5600"), "0")
  assert.equal(congressionalGeoId("WY", parseDistrictCode("5600")!), "US-WY-congressional-0")
})

test("delegate and undefined seats are not districts", () => {
  // DC: GEOID 1198. A delegate seat nobody is elected to from a district.
  assert.equal(parseDistrictCode("1198"), null)
  assert.equal(parseDistrictCode("98"), null)
  assert.equal(parseDistrictCode("99"), null)
})

test("rejects anything that is not a district code", () => {
  assert.equal(parseDistrictCode(null), null)
  assert.equal(parseDistrictCode(undefined), null)
  assert.equal(parseDistrictCode(""), null)
  assert.equal(parseDistrictCode("Delegate District (at Large)"), null)
  assert.equal(parseDistrictCode("ZZ"), null)
})

test("geo_id spelling matches the importer", () => {
  assert.equal(congressionalGeoId("tx", "38"), "US-TX-congressional-38")
})
