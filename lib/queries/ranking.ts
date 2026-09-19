import type { TopicMode } from "./feed"

/**
 * Personal relevance ranking, as a pure function.
 *
 * The feed does this in SQL, because the re-ranking has to happen before the
 * page limit: boosting in Node after fetching 20 rows would only reorder the
 * 20 rows that the unboosted query happened to return, which is not boosting
 * at all - it is shuffling an already-wrong page.
 *
 * This module is the same rule written against a list in memory. It exists for
 * two reasons: it is the executable specification the SQL is checked against,
 * and it is what a caller with rows already in hand (a saved list, a candidate
 * timeline) should use rather than writing a second ordering.
 *
 * Same relationship as collapseByQuote in lib/pipeline/dedup.ts. If one of the
 * two changes, the other is wrong.
 */

export type RankSort = "recent" | "relevant" | "saved"

/** The fields the ordering reads. Anything with these can be ranked. */
export interface RankableRow {
  id: string
  /** Every tag on the row, including the primary one. */
  topics: string[]
  /** The primary tag. Checked too, for rows written before insight_topics. */
  issueTag: string
  relevanceScore: number
  createdAt: Date
  savedAt?: Date | null
}

/**
 * Does this row match any of the reader's issues?
 *
 * Checks the tag list and the primary column, matching the SQL's `taggedWith`.
 * Both are consulted because rows written before the join table existed carry
 * only issue_tag, and treating those as "matches nothing" would make a
 * personal feed look empty on exactly the data that already exists.
 */
export function matchesInterests(
  row: Pick<RankableRow, "topics" | "issueTag">,
  selectedTopics: readonly string[],
): boolean {
  if (selectedTopics.length === 0) return false
  const wanted = new Set(selectedTopics)
  if (wanted.has(row.issueTag)) return true
  return row.topics.some((t) => wanted.has(t))
}

export interface RankOptions {
  /** "boost" puts matches first, "strict" drops non-matches. Default boost. */
  mode?: TopicMode
  /** Which ordering applies within each bucket. Default "recent". */
  sort?: RankSort
}

/**
 * Order rows for a reader.
 *
 * With no selected topics this is the plain feed order, unchanged - a reader
 * who has not onboarded gets everything, never an empty list.
 *
 * In `boost` mode the matches come first and everything else follows in the
 * same order it would otherwise have had. That "and everything else follows"
 * is the point of the default: a feed that only ever showed three issues would
 * quietly become the whole app for someone who ticked three boxes once.
 */
export function rankByInterests<T extends RankableRow>(
  rows: readonly T[],
  selectedTopics: readonly string[],
  options: RankOptions = {},
): T[] {
  const mode: TopicMode = options.mode === "strict" ? "strict" : "boost"
  const sort: RankSort = options.sort ?? "recent"

  const considered =
    mode === "strict" && selectedTopics.length > 0
      ? rows.filter((row) => matchesInterests(row, selectedTopics))
      : [...rows]

  // Boosting with nothing selected would put every row in the same bucket, so
  // it is skipped rather than applied as a constant.
  const boosting = mode === "boost" && selectedTopics.length > 0

  return considered.sort((a, b) => {
    if (boosting) {
      const bucket =
        Number(matchesInterests(b, selectedTopics)) -
        Number(matchesInterests(a, selectedTopics))
      if (bucket !== 0) return bucket
    }
    return compareWithin(a, b, sort)
  })
}

/**
 * The tiebreak chain within one bucket, matching the SQL's ORDER BY exactly.
 *
 * The id is the last term in every ordering, and it is not decoration: a
 * keyset cursor needs a total order, and two rows created in the same
 * millisecond with the same score would otherwise be able to swap places
 * between two page requests and be skipped or repeated.
 */
function compareWithin(a: RankableRow, b: RankableRow, sort: RankSort): number {
  if (sort === "relevant") {
    return (
      b.relevanceScore - a.relevanceScore ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      compareIdDesc(a.id, b.id)
    )
  }

  if (sort === "saved") {
    return (
      (b.savedAt?.getTime() ?? 0) - (a.savedAt?.getTime() ?? 0) || compareIdDesc(a.id, b.id)
    )
  }

  return b.createdAt.getTime() - a.createdAt.getTime() || compareIdDesc(a.id, b.id)
}

function compareIdDesc(a: string, b: string): number {
  return b.localeCompare(a)
}

/**
 * Split a ranked list into the boosted head and the rest.
 *
 * For a UI that wants to draw a "more from everywhere" divider, and for tests
 * that want to assert the boundary rather than infer it from an index.
 */
export function splitByInterest<T extends RankableRow>(
  rows: readonly T[],
  selectedTopics: readonly string[],
): { matching: T[]; other: T[] } {
  const matching: T[] = []
  const other: T[] = []

  for (const row of rows) {
    if (matchesInterests(row, selectedTopics)) matching.push(row)
    else other.push(row)
  }

  return { matching, other }
}
