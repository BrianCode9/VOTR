import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { matchesInterests, rankByInterests, splitByInterest, type RankableRow } from "./ranking"
import { decodeCursor, encodeCursor } from "./feed"

/**
 * The boosted-ranking order.
 *
 * These assert the rule the feed's SQL implements. When one changes the other
 * is wrong; see the note at the top of ranking.ts.
 */

let counter = 0

function row(overrides: Partial<RankableRow> = {}): RankableRow {
  counter++
  return {
    id: `0000000${counter}-0000-4000-8000-000000000000`,
    topics: ["housing"],
    issueTag: "housing",
    relevanceScore: 0.5,
    // Descending by default, so "document order" and "feed order" agree and a
    // test that cares about the tiebreak has to say so explicitly.
    createdAt: new Date(Date.UTC(2026, 0, 100 - counter)),
    ...overrides,
  }
}

const HOUSING = ["housing"]
const PICKS = ["housing", "climate"]

describe("matchesInterests", () => {
  test("matches on the primary tag", () => {
    assert.equal(matchesInterests({ topics: [], issueTag: "housing" }, HOUSING), true)
  })

  test("matches on a secondary tag", () => {
    // The rent-freeze case: primarily economy, also housing. A reader who
    // picked housing should see it.
    assert.equal(
      matchesInterests({ topics: ["economy", "housing"], issueTag: "economy" }, HOUSING),
      true,
    )
  })

  test("matches a row that predates the topics table", () => {
    // Those rows have issue_tag and no join rows at all. Treating them as
    // unmatched would make a personal feed look empty on existing data.
    assert.equal(matchesInterests({ topics: [], issueTag: "climate" }, PICKS), true)
  })

  test("does not match an unrelated row", () => {
    assert.equal(matchesInterests({ topics: ["guns"], issueTag: "guns" }, PICKS), false)
  })

  test("no selection matches nothing", () => {
    assert.equal(matchesInterests({ topics: ["housing"], issueTag: "housing" }, []), false)
  })
})

describe("boosted ranking", () => {
  test("selected topics come first, everything else follows", () => {
    const guns = row({ issueTag: "guns", topics: ["guns"] })
    const housing = row({ issueTag: "housing", topics: ["housing"] })
    const veterans = row({ issueTag: "veterans", topics: ["veterans"] })
    const climate = row({ issueTag: "climate", topics: ["climate"] })

    const ranked = rankByInterests([guns, housing, veterans, climate], PICKS)

    assert.deepEqual(
      ranked.map((r) => r.issueTag),
      ["housing", "climate", "guns", "veterans"],
    )
  })

  test("the tail is still there - boosting is not filtering", () => {
    // The whole reason boost is the default: a reader who ticked three boxes
    // once should not have the app become only those three subjects.
    const rows = [row({ issueTag: "guns", topics: ["guns"] }), row()]
    assert.equal(rankByInterests(rows, HOUSING).length, 2)
  })

  test("within the boosted bucket the normal order is preserved", () => {
    const older = row({ createdAt: new Date("2026-01-01T00:00:00Z") })
    const newer = row({ createdAt: new Date("2026-06-01T00:00:00Z") })

    const ranked = rankByInterests([older, newer], HOUSING)
    assert.deepEqual(ranked.map((r) => r.id), [newer.id, older.id])
  })

  test("within the tail the normal order is preserved too", () => {
    const olderOther = row({
      issueTag: "guns",
      topics: ["guns"],
      createdAt: new Date("2026-01-01T00:00:00Z"),
    })
    const newerOther = row({
      issueTag: "guns",
      topics: ["guns"],
      createdAt: new Date("2026-06-01T00:00:00Z"),
    })
    const match = row()

    const ranked = rankByInterests([olderOther, match, newerOther], HOUSING)
    assert.deepEqual(ranked.map((r) => r.id), [match.id, newerOther.id, olderOther.id])
  })

  test("a boosted low-relevance card outranks an unboosted high-relevance one", () => {
    // The bucket leads the sort. This is the whole behavior: relevance orders
    // within a bucket, it does not cross between them.
    const strongOther = row({ issueTag: "guns", topics: ["guns"], relevanceScore: 0.99 })
    const weakMatch = row({ relevanceScore: 0.01 })

    const ranked = rankByInterests([strongOther, weakMatch], HOUSING, { sort: "relevant" })
    assert.deepEqual(ranked.map((r) => r.id), [weakMatch.id, strongOther.id])
  })

  test("relevance orders within the boosted bucket", () => {
    const weak = row({ relevanceScore: 0.2 })
    const strong = row({ relevanceScore: 0.8 })

    const ranked = rankByInterests([weak, strong], HOUSING, { sort: "relevant" })
    assert.deepEqual(ranked.map((r) => r.id), [strong.id, weak.id])
  })

  test("no selection leaves the order exactly as it was", () => {
    const rows = [row({ issueTag: "guns", topics: ["guns"] }), row(), row({ issueTag: "climate" })]
    const ranked = rankByInterests(rows, [])
    const plain = rankByInterests(rows, [], { mode: "strict" })

    assert.deepEqual(ranked.map((r) => r.id), plain.map((r) => r.id))
    assert.equal(ranked.length, 3, "a reader with no profile gets the whole feed")
  })

  test("a multi-tagged card is boosted on its secondary tag", () => {
    const rentFreeze = row({ issueTag: "economy", topics: ["economy", "housing"] })
    const unrelated = row({
      issueTag: "guns",
      topics: ["guns"],
      createdAt: new Date("2030-01-01T00:00:00Z"),
    })

    const ranked = rankByInterests([unrelated, rentFreeze], HOUSING)
    assert.deepEqual(ranked.map((r) => r.id), [rentFreeze.id, unrelated.id])
  })

  test("ties break by id so the order is total", () => {
    // A keyset cursor over a non-total order skips and repeats rows.
    const at = new Date("2026-03-01T00:00:00Z")
    const a = row({ id: "aaaaaaaa-0000-4000-8000-000000000000", createdAt: at })
    const b = row({ id: "bbbbbbbb-0000-4000-8000-000000000000", createdAt: at })

    assert.deepEqual(
      rankByInterests([a, b], HOUSING).map((r) => r.id),
      rankByInterests([b, a], HOUSING).map((r) => r.id),
      "input order changed the output, so the ordering is not total",
    )
  })
})

describe("strict filtering", () => {
  test("only selected topics survive", () => {
    const rows = [
      row({ issueTag: "guns", topics: ["guns"] }),
      row(),
      row({ issueTag: "climate", topics: ["climate"] }),
    ]

    const ranked = rankByInterests(rows, PICKS, { mode: "strict" })
    assert.deepEqual(ranked.map((r) => r.issueTag).sort(), ["climate", "housing"])
  })

  test("a secondary tag is enough to survive", () => {
    const rentFreeze = row({ issueTag: "economy", topics: ["economy", "housing"] })
    const ranked = rankByInterests([rentFreeze], HOUSING, { mode: "strict" })
    assert.equal(ranked.length, 1)
  })

  test("strict with no selection is not an empty feed", () => {
    // "Show me only my topics" with no topics chosen must not mean "show me
    // nothing". It means there is nothing to narrow by.
    const rows = [row(), row({ issueTag: "guns", topics: ["guns"] })]
    assert.equal(rankByInterests(rows, [], { mode: "strict" }).length, 2)
  })

  test("strict can legitimately return nothing", () => {
    const rows = [row({ issueTag: "guns", topics: ["guns"] })]
    assert.equal(rankByInterests(rows, HOUSING, { mode: "strict" }).length, 0)
  })
})

describe("saved ordering", () => {
  test("orders by when it was saved, not when it was published", () => {
    const oldArticleSavedNow = row({
      createdAt: new Date("2020-01-01T00:00:00Z"),
      savedAt: new Date("2026-09-19T00:00:00Z"),
    })
    const newArticleSavedLongAgo = row({
      createdAt: new Date("2026-09-01T00:00:00Z"),
      savedAt: new Date("2026-09-02T00:00:00Z"),
    })

    const ranked = rankByInterests([newArticleSavedLongAgo, oldArticleSavedNow], [], {
      sort: "saved",
    })
    assert.deepEqual(ranked.map((r) => r.id), [oldArticleSavedNow.id, newArticleSavedLongAgo.id])
  })
})

describe("splitByInterest", () => {
  test("separates the boosted head from the tail", () => {
    const match = row()
    const other = row({ issueTag: "guns", topics: ["guns"] })

    const { matching, other: rest } = splitByInterest(
      rankByInterests([other, match], HOUSING),
      HOUSING,
    )

    assert.deepEqual(matching.map((r) => r.id), [match.id])
    assert.deepEqual(rest.map((r) => r.id), [other.id])
  })
})

describe("the feed cursor with a boost bucket", () => {
  test("round-trips the bucket", () => {
    const encoded = encodeCursor({
      s: "recent",
      b: 1,
      t: "2026-09-19T00:00:00.000Z",
      id: "aaaaaaaa-0000-4000-8000-000000000000",
    })

    const decoded = decodeCursor(encoded, "recent")
    assert.equal(decoded?.b, 1)
  })

  test("a bucket of 0 survives the round trip", () => {
    // It has to: 0 means "the reader has run past their own topics into the
    // tail", and losing it would restart the boosted section.
    const encoded = encodeCursor({
      s: "relevant",
      b: 0,
      r: 0.4,
      t: "2026-09-19T00:00:00.000Z",
      id: "aaaaaaaa-0000-4000-8000-000000000000",
    })

    const decoded = decodeCursor(encoded, "relevant")
    assert.equal(decoded?.b, 0)
  })

  test("a cursor from a different sort is ignored rather than misapplied", () => {
    const encoded = encodeCursor({
      s: "recent",
      b: 1,
      t: "2026-09-19T00:00:00.000Z",
      id: "aaaaaaaa-0000-4000-8000-000000000000",
    })

    assert.equal(decodeCursor(encoded, "relevant"), null)
  })
})
