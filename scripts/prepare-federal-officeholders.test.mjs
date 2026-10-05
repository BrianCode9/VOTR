import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { buildSnapshot } from "./prepare-federal-officeholders.mjs"

const raw = readFileSync("data/candidates/raw/legislators-current.json", "utf8")

test("builds complete current congressional coverage", () => {
  const snapshot = buildSnapshot(raw, "2026-09-20T00:00:00.000Z")
  assert.deepEqual(snapshot.coverage, {
    senators: 100,
    votingRepresentatives: 433,
    delegatesAndResidentCommissioner: 6,
    vacantVotingSeats: ["FL-20", "TX-23"],
    totalOfficeholders: 539,
  })
  assert.equal(new Set(snapshot.members.map((member) => member.bioguideId)).size, 539)
  assert.equal(snapshot.members.every((member) => member.biography && member.officialWebsite), true)
})

test("keeps identifiers, contact data, and service history", () => {
  const snapshot = buildSnapshot(raw, "2026-09-20T00:00:00.000Z")
  const senator = snapshot.members.find((member) => member.bioguideId === "C000127")
  assert.equal(senator.chamber, "senate")
  assert.equal(senator.stateRank, "junior")
  assert.ok(senator.contactForm.startsWith("https://"))
  assert.ok(senator.identifiers.fec.length > 0)
  assert.ok(senator.serviceHistory.length > 1)
})
