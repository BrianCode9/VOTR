import { eq, sql } from "drizzle-orm"
import { db, hasDatabase } from "@/db"
import { insightCorroborations } from "@/db/schema"
import {
  claimsCorroborate,
  corroborationThresholdsFromEnv,
  sourceKey,
  type CorroborationSubject,
  type CorroborationThresholds,
} from "../pipeline/corroborate"
import type { CardType } from "../schemas/insight"

/**
 * Keeping the source-diversity counts current.
 *
 * The judgment - do these two insights report the same thing - is in
 * lib/pipeline/corroborate.ts and is pure. This module is the database half:
 * find the small set of insights that could possibly match, ask, and write the
 * links and the counts.
 *
 * Incremental by construction. A new document never triggers a full rescan;
 * it looks only at insights that already share a speaker and a primary topic
 * with one of its own, which is the only set that can contain a match, because
 * both are hard gates in claimsCorroborate. That set is a handful of rows and
 * is reached by the `insights_speaker_issue_idx` index.
 *
 * Both directions of every link are written. It costs two rows per pair and
 * means a read from either side is one index scan rather than an OR over two
 * columns, which matters because the feed reads it on every card.
 */

export interface CorroborationUpdate {
  insightId: string
  count: number
  sourceKeys: string[]
  /** Links created on this pass. Zero on a re-run that found nothing new. */
  linksWritten: number
}

export interface CorroborationRunResult {
  /** Insights whose stored count this pass changed. */
  updated: CorroborationUpdate[]
  /** Insights looked at, including those whose count did not move. */
  scanned: number
  linksWritten: number
}

interface CandidateRow {
  [column: string]: unknown
  id: string
  card_type: CardType
  issue_tag: string
  speaker_id: string | null
  candidate_name: string | null
  position_text: string
  document_id: string
  source_name: string
  source_url: string
}

function toSubject(row: CandidateRow): CorroborationSubject {
  return {
    id: row.id,
    cardType: row.card_type,
    topic: row.issue_tag,
    speakerId: row.speaker_id,
    speakerName: row.candidate_name,
    headline: row.position_text,
    sourceKey: sourceKey(row.source_name, row.source_url),
    documentId: row.document_id,
  }
}

const SUBJECT_COLUMNS = sql`
  i.id,
  i.card_type,
  i.issue_tag,
  i.speaker_id,
  coalesce(sp.name, c.name) as candidate_name,
  i.position_text,
  i.document_id,
  d.source_name,
  d.url as source_url
`

const SUBJECT_JOINS = sql`
  join documents d on d.id = i.document_id
  left join candidates c on c.id = i.candidate_id
  left join speakers sp on sp.id = i.speaker_id
`

/**
 * Recompute corroboration for one insight and everything it touches.
 *
 * Returns an entry for every row whose stored count changed, the subject
 * included. The far side matters: when insight B starts corroborating A, A's
 * count went up too, and a pass that only wrote B's would leave the feed
 * showing "1 source" on a card that now has two.
 */
export async function recomputeCorroborationFor(
  insightId: string,
  options: { thresholds?: CorroborationThresholds } = {},
): Promise<CorroborationRunResult> {
  if (!hasDatabase) return { updated: [], scanned: 0, linksWritten: 0 }

  const [row] = [
    ...(await db.execute<CandidateRow>(sql`
      select ${SUBJECT_COLUMNS}
        from insights i
        ${SUBJECT_JOINS}
       where i.id = ${insightId}::uuid
       limit 1
    `)),
  ]
  if (!row) return { updated: [], scanned: 0, linksWritten: 0 }

  return recomputeForSubjects([toSubject(row)], options)
}

/**
 * The hook the pipeline calls after a document's insights are written.
 *
 * One query loads the document's own insights, one loads every insight that
 * could match any of them, and the matching happens in memory. That is the
 * shape that makes this incremental: the second query is bounded by the
 * document's own (speaker, topic) pairs, not by the size of the table.
 */
export async function corroborateDocument(
  documentId: string,
  options: { thresholds?: CorroborationThresholds } = {},
): Promise<CorroborationRunResult> {
  if (!hasDatabase) return { updated: [], scanned: 0, linksWritten: 0 }

  const rows = [
    ...(await db.execute<CandidateRow>(sql`
      select ${SUBJECT_COLUMNS}
        from insights i
        ${SUBJECT_JOINS}
       where i.document_id = ${documentId}::uuid
         and i.status = 'published'
    `)),
  ]
  if (rows.length === 0) return { updated: [], scanned: 0, linksWritten: 0 }

  return recomputeForSubjects(rows.map(toSubject), options)
}

/**
 * Recompute the whole table, one (speaker, topic) group at a time.
 *
 * For the backfill and for `npm run corroborate`. Not what a new document
 * triggers: it reads every published insight, which is exactly the cost the
 * incremental path exists to avoid.
 */
export async function recomputeAllCorroboration(
  options: { thresholds?: CorroborationThresholds } = {},
): Promise<CorroborationRunResult> {
  if (!hasDatabase) return { updated: [], scanned: 0, linksWritten: 0 }

  const rows = [
    ...(await db.execute<CandidateRow>(sql`
      select ${SUBJECT_COLUMNS}
        from insights i
        ${SUBJECT_JOINS}
       where i.status = 'published'
    `)),
  ]

  return recomputeForSubjects(rows.map(toSubject), options)
}

/**
 * The shared core.
 *
 * Everything above differs only in which subjects it hands in; the peer
 * lookup, the matching, the link writes, and the count updates are one
 * implementation so a full rescan and an incremental pass cannot disagree
 * about what the count is.
 */
async function recomputeForSubjects(
  subjects: CorroborationSubject[],
  options: { thresholds?: CorroborationThresholds },
): Promise<CorroborationRunResult> {
  const thresholds = options.thresholds ?? corroborationThresholdsFromEnv()
  if (subjects.length === 0) return { updated: [], scanned: 0, linksWritten: 0 }

  const peers = await loadPeers(subjects)

  // Subjects are peers of each other too: two documents ingested in one run
  // corroborate perfectly well, and leaving them out would make the count
  // depend on how a batch happened to be split.
  const pool = new Map<string, CorroborationSubject>()
  for (const peer of peers) pool.set(peer.id, peer)
  for (const subject of subjects) pool.set(subject.id, subject)

  const matchesById = new Map<string, Map<string, MatchRecord>>()
  const subjectIds = new Set(subjects.map((s) => s.id))
  const touched = new Set<string>(subjectIds)

  for (const subject of subjects) {
    for (const peer of pool.values()) {
      const verdict = claimsCorroborate(subject, peer, thresholds)
      if (!verdict.corroborates) continue

      // Written from both sides, so the far row is refreshed in the same pass
      // rather than waiting for something else to touch it.
      record(matchesById, subject.id, peer, verdict.score, verdict.reason)
      record(matchesById, peer.id, subject, verdict.score, verdict.reason)
      touched.add(peer.id)
    }
  }

  // Collected across every touched insight and written in chunks. A statement
  // per insight would be a round trip per insight, and a full rescan touches
  // the whole published table - that is the difference between a maintenance
  // job that takes a second and one that reads as a hang.
  const linkRows: {
    insightId: string
    match: MatchRecord
  }[] = []
  const keepPairs: { insightId: string; corroboratingInsightId: string }[] = []

  for (const id of touched) {
    for (const match of matchesById.get(id)?.values() ?? []) {
      linkRows.push({ insightId: id, match })
      if (subjectIds.has(id)) {
        keepPairs.push({ insightId: id, corroboratingInsightId: match.subject.id })
      }
    }
  }

  let linksWritten = 0
  for (const chunk of chunks(linkRows, 500)) {
    const values = chunk.map(
      ({ insightId, match }) =>
        sql`(${insightId}::uuid, ${match.subject.id}::uuid, ${match.subject.documentId}::uuid, ${match.subject.sourceKey}, ${match.score}::real, ${match.reason})`,
    )

    const written = await db.execute(sql`
      insert into insight_corroborations
        (insight_id, corroborating_insight_id, document_id, source_key, match_score, match_reason)
      values ${sql.join(values, sql`, `)}
      on conflict (insight_id, corroborating_insight_id) do update
        set match_score = excluded.match_score,
            match_reason = excluded.match_reason,
            document_id = excluded.document_id,
            source_key = excluded.source_key
      returning insight_id
    `)
    linksWritten += [...written].length
  }

  // Stale links are pruned only for the SUBJECTS, and the distinction is
  // load-bearing. A subject was compared against every insight that could
  // possibly match it, so anything absent from its fresh match set no longer
  // corroborates it - a position was reworded, a source name was corrected.
  // A PEER was only compared against the subjects, so most of its links were
  // never in scope here and deleting them would silently destroy counts this
  // pass had no business touching.
  for (const chunk of chunks([...subjectIds], 500)) {
    const ids = chunk.map((id) => sql`${id}::uuid`)
    const keep = keepPairs
      .filter((pair) => chunk.includes(pair.insightId))
      .map((pair) => sql`(${pair.insightId}::uuid, ${pair.corroboratingInsightId}::uuid)`)

    await db.execute(sql`
      delete from insight_corroborations
       where insight_id in (${sql.join(ids, sql`, `)})
         ${
           keep.length > 0
             ? sql`and (insight_id, corroborating_insight_id) not in (${sql.join(keep, sql`, `)})`
             : sql``
         }
    `)
  }

  const updated = await refreshCountsFromLinks(
    [...touched].flatMap((id) => {
      const subject = pool.get(id)
      return subject ? [{ id, ownSourceKey: subject.sourceKey }] : []
    }),
  )

  return { updated, scanned: touched.size, linksWritten }
}

/**
 * Recompute the stored counts from the link table, not from this pass.
 *
 * This is the step that makes an incremental pass produce the same number a
 * full rescan would. A count derived from the matches found just now would be
 * right for a subject - which was compared against everything that could match
 * it - and WRONG for a peer, which was only compared against the subjects. A
 * peer that already had two corroborators and gains a third would be written
 * back as two, and the number would get quietly worse every time a document
 * arrived.
 *
 * Reading the link table instead makes the count a fact about the stored
 * graph, and the graph is symmetric, so it is the same answer from either end.
 *
 * The rule it implements is the one in lib/pipeline/corroborate.ts: distinct
 * sources, this insight's own first, never fewer than 1. That function stays
 * the definition and this SQL mirrors it; the fixture seed runs both paths
 * over the same data, which is where a divergence would show up.
 */
async function refreshCountsFromLinks(
  entries: { id: string; ownSourceKey: string }[],
): Promise<CorroborationUpdate[]> {
  if (entries.length === 0) return []

  const out: CorroborationUpdate[] = []
  for (const chunk of chunks(entries, 500)) out.push(...(await refreshChunk(chunk)))
  return out
}

async function refreshChunk(
  entries: { id: string; ownSourceKey: string }[],
): Promise<CorroborationUpdate[]> {
  const rows = entries.map((e) => sql`(${e.id}::uuid, ${e.ownSourceKey})`)

  const updated = await db.execute<{
    [column: string]: unknown
    id: string
    corroboration_count: number
    corroborating_source_ids: string[] | null
  }>(sql`
    with own (id, own_key) as (values ${sql.join(rows, sql`, `)}),
    agg as (
      select
        o.id,
        o.own_key,
        coalesce(
          array_agg(distinct ic.source_key) filter (
            -- Only links to rows a reader could actually be shown. A
            -- corroborating insight that was later unpublished must stop
            -- counting, or the number claims evidence the app will not show.
            where ci.id is not null and ic.source_key <> o.own_key
          ),
          '{}'::text[]
        ) as others
      from own o
      left join insight_corroborations ic on ic.insight_id = o.id
      -- The published test is a JOIN condition, not a WHERE clause. As a WHERE
      -- it would drop the whole group for an insight whose only link points at
      -- an unpublished row, and that insight would then keep its stale count
      -- forever - the one row that most needs correcting.
      left join insights ci
        on ci.id = ic.corroborating_insight_id and ci.status = 'published'
      group by o.id, o.own_key
    )
    update insights i
       set corroborating_source_ids = array_prepend(a.own_key, a.others),
           corroboration_count = 1 + cardinality(a.others),
           corroboration_checked_at = now()
      from agg a
     where i.id = a.id
    returning i.id, i.corroboration_count, i.corroborating_source_ids
  `)

  return [...updated].map((row) => ({
    insightId: row.id,
    count: Number(row.corroboration_count),
    sourceKeys: row.corroborating_source_ids ?? [],
    linksWritten: Math.max(0, Number(row.corroboration_count) - 1),
  }))
}

interface MatchRecord {
  subject: CorroborationSubject
  score: number
  reason: string
}

function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size)
}

function record(
  index: Map<string, Map<string, MatchRecord>>,
  forId: string,
  match: CorroborationSubject,
  score: number,
  reason: string,
): void {
  let bucket = index.get(forId)
  if (!bucket) {
    bucket = new Map()
    index.set(forId, bucket)
  }
  bucket.set(match.id, { subject: match, score, reason })
}

/**
 * Every published insight that could possibly corroborate one of these.
 *
 * Bounded by the subjects' own (speaker, topic) pairs, which is the whole
 * reason this is incremental. Both gates are hard requirements in
 * claimsCorroborate, so nothing outside this set can match, and widening the
 * query would only cost rows that are then rejected.
 *
 * Unattributed insights are excluded here rather than rejected later: with no
 * speaker there is nothing to agree about, and pulling them in would make the
 * peer set every anonymous claim on the topic.
 */
async function loadPeers(subjects: CorroborationSubject[]): Promise<CorroborationSubject[]> {
  const bySpeakerId = new Map<string, Set<string>>()
  const byName = new Map<string, Set<string>>()

  for (const subject of subjects) {
    if (subject.speakerId) add(bySpeakerId, subject.speakerId, subject.topic)
    else if (subject.speakerName) add(byName, subject.speakerName, subject.topic)
  }

  const clauses = [
    ...[...bySpeakerId].map(
      ([speakerId, topics]) =>
        sql`(i.speaker_id = ${speakerId}::uuid and i.issue_tag in ${list([...topics])})`,
    ),
    // The name fallback exists for rows written before speakers were resolved.
    // It compares the candidate name as stored; normalizeSpeakerName then has
    // the final say in claimsCorroborate, so a loose SQL match costs a
    // rejected row rather than a wrong count.
    ...[...byName].map(
      ([name, topics]) =>
        sql`(c.name = ${name} and i.issue_tag in ${list([...topics])})`,
    ),
  ]

  if (clauses.length === 0) return []

  const ids = subjects.map((s) => sql`${s.id}::uuid`)

  const rows = await db.execute<CandidateRow>(sql`
    select ${SUBJECT_COLUMNS}
      from insights i
      ${SUBJECT_JOINS}
     where i.status = 'published'
       and i.id not in (${sql.join(ids, sql`, `)})
       and (${sql.join(clauses, sql` or `)})
     limit 500
  `)

  return [...rows].map(toSubject)
}

function add(index: Map<string, Set<string>>, key: string, topic: string): void {
  const bucket = index.get(key)
  if (bucket) bucket.add(topic)
  else index.set(key, new Set([topic]))
}

/** A parenthesised, fully parameterised value list for an IN clause. */
function list(items: string[]) {
  return sql`(${sql.join(
    items.map((item) => sql`${item}`),
    sql`, `,
  )})`
}

/**
 * The corroborating sources behind one insight, for the API response.
 *
 * Reads the link table rather than `corroborating_source_ids`, because the
 * array holds source keys and a client rendering an icon row needs the outlet
 * name it would actually print and a link to the other article. One row per
 * source, the most recent article from each, capped by the caller.
 */
export interface CorroboratingSource {
  sourceName: string
  sourceUrl: string
  documentId: string
  insightId: string
  publishedAt: Date | null
}

export async function corroboratingSourcesFor(
  insightId: string,
  limit = 10,
): Promise<CorroboratingSource[]> {
  if (!hasDatabase) return []

  const rows = await db.execute<{
    [column: string]: unknown
    source_name: string
    source_url: string
    document_id: string
    insight_id: string
    published_at: string | Date | null
  }>(sql`
    select distinct on (ic.source_key)
           d.source_name, d.url as source_url, d.id as document_id,
           ic.corroborating_insight_id as insight_id, d.published_at
      from insight_corroborations ic
      join insights i on i.id = ic.corroborating_insight_id and i.status = 'published'
      join documents d on d.id = ic.document_id
     where ic.insight_id = ${insightId}::uuid
     order by ic.source_key, d.published_at desc nulls last
     limit ${Math.min(Math.max(1, limit), 50)}
  `)

  return [...rows].map((row) => ({
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    documentId: row.document_id,
    insightId: row.insight_id,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
  }))
}

/** Clear every link for an insight. Used when a document is re-processed. */
export async function clearCorroborationFor(insightId: string): Promise<number> {
  const removed = await db
    .delete(insightCorroborations)
    .where(eq(insightCorroborations.insightId, insightId))
    .returning({ insightId: insightCorroborations.insightId })

  return removed.length
}
