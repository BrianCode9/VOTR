import { sql } from "drizzle-orm"
import { db, hasDatabase } from "@/db"

/**
 * "Has this person been on record about this issue before?"
 *
 * The one database fact the flag rules need. It lives here rather than in
 * lib/flags so that assignFlags stays pure and exhaustively testable: the
 * rules take a boolean, and this module is what produces it.
 *
 * Matching is on the PRIMARY topic (insights.issue_tag), not on the
 * many-to-many topic tags. A speaker who has talked about housing before is
 * not newly on the record just because this particular card also happens to be
 * tagged `economy`. One card, one answer.
 */

/** The composite key. Kept in one place so both sides spell it identically. */
export function historyKey(candidateId: string, topic: string): string {
  return `${candidateId}|${topic}`
}

export interface HistoryPair {
  candidateId: string
  topic: string
}

/**
 * Which of these (speaker, topic) pairs already have an insight on record.
 *
 * One query for the whole batch rather than one per item: a document about a
 * single candidate produces a handful of cards, and asking the database
 * separately for each is a round trip per card for an answer that does not
 * change between them.
 *
 * `excludeDocumentId` is what makes re-processing a document idempotent. Its
 * own rows are already in the table on a second run, so without the exclusion
 * every card would lose its NEW badge the second time through, and the same
 * pipeline over the same input would produce different flags.
 */
export async function existingHistoryPairs(
  pairs: readonly HistoryPair[],
  options: { excludeDocumentId?: string } = {},
): Promise<Set<string>> {
  if (pairs.length === 0 || !hasDatabase) return new Set()

  // De-duplicate first: several cards in one document routinely share a pair.
  const unique = new Map<string, HistoryPair>()
  for (const pair of pairs) {
    if (!pair.candidateId || !pair.topic) continue
    unique.set(historyKey(pair.candidateId, pair.topic), pair)
  }
  if (unique.size === 0) return new Set()

  const tuples = sql.join(
    [...unique.values()].map((p) => sql`(${p.candidateId}::uuid, ${p.topic})`),
    sql`, `,
  )

  const rows = await db.execute<{
    [column: string]: unknown
    candidate_id: string
    issue_tag: string
  }>(sql`
    select distinct i.candidate_id, i.issue_tag
    from insights i
    where (i.candidate_id, i.issue_tag) in (${tuples})
      ${options.excludeDocumentId ? sql`and i.document_id <> ${options.excludeDocumentId}::uuid` : sql``}
  `)

  return new Set([...rows].map((r) => historyKey(r.candidate_id, r.issue_tag)))
}
