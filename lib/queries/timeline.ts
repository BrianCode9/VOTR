import { sql, type SQL } from "drizzle-orm"
import { db, hasDatabase } from "@/db"
import type { ConfidenceLabel, PresentationMode } from "../confidence/score"
import type { InsightFlag } from "../flags/types"

/**
 * One person's record on one issue, in the order it happened.
 *
 * The question this answers is the one a candidate page exists for: what has
 * this person said, when, and did it change. Everything here is grouped on
 * `insights.speaker_id` rather than on `candidate_id`, and that is the whole
 * reason `speakers` exists - a candidate row is scoped to a race, so a
 * timeline keyed on it shows a fraction of a person's history and presents it
 * as the whole of it.
 *
 * Two shapes of entry, chosen by `include`:
 *
 *   flip_flops      only insights carrying the FLIP_FLOP badge. The default,
 *                   and the honest one: the badge means a change was detected
 *                   AND cleared the confidence bar in lib/flags/assign.ts.
 *   stance_changes  every `stance_change` card, badge or not. A card below the
 *                   flip-flop confidence bar is still a recorded shift in
 *                   position; it just is not one this app is willing to call a
 *                   flip-flop. Callers that show this must not label them as
 *                   such, which is why `flags` rides along on every entry.
 *
 * The date is the document's publication date, falling back to when the row
 * was written. A timeline ordered by insertion would put a decade-old
 * transcript ingested this morning after last week's article, which is the
 * one ordering a reader would read as a lie.
 */

export interface TimelineEntry {
  /** The insight this entry renders. Stable id for a key or a deep link. */
  id: string
  /** Publication date of the source, falling back to when the row was written. */
  date: Date
  /** True when `date` is the row's creation date because the source had none. */
  dateIsApproximate: boolean
  /** Primary issue slug. */
  topic: string
  /** Human label for `topic`, from the topics table. Falls back to the slug. */
  topicLabel: string
  topicId: string | null
  /**
   * Where the person stood before. Null on an entry that is not a stance
   * change, and on one whose extraction recorded no prior position.
   */
  previousPosition: string | null
  /** Where they stand in this document. Always present. */
  currentPosition: string
  /** Sliced from the stored document at the verified offsets. Never stored text. */
  quote: string
  sourceUrl: string
  sourceName: string
  documentId: string
  documentTitle: string
  publishedAt: Date | null
  confidenceLabel: ConfidenceLabel
  /** What a client may do with this entry. See lib/confidence/score.ts. */
  presentationMode: PresentationMode
  verifyYourself: boolean
  /** Independent sources reporting this, including this one. At least 1. */
  corroborationCount: number
  /** Every badge the insight carries, so a caller can tell a flip-flop apart. */
  flags: InsightFlag[]
  /** The prior insight this was compared against, when one was linked. */
  priorInsightId: string | null
}

export interface TimelineSpeaker {
  id: string
  name: string
  party: string | null
  role: string | null
}

export interface CandidateTimeline {
  speaker: TimelineSpeaker | null
  entries: TimelineEntry[]
  /** Pass back as `cursor`. Null means the run is over. */
  nextCursor: string | null
  order: TimelineOrder
  include: TimelineInclude
  /** Echoed back so a client can show what it filtered by without re-parsing. */
  filters: {
    topicId: string | null
    topicSlug: string | null
    from: Date | null
    to: Date | null
  }
}

export type TimelineOrder = "asc" | "desc"
export type TimelineInclude = "flip_flops" | "stance_changes"

export interface TimelineQuery {
  speakerId: string
  /**
   * Single-issue timeline. Accepts a `topics.id` uuid or a slug, because a
   * client that has a slug from a feed card should not have to look the uuid
   * up first. Resolved to whichever it is; an unknown value filters to nothing
   * rather than being ignored, so a typo is visible instead of silent.
   */
  topicId?: string | null
  from?: Date | null
  to?: Date | null
  /** Default `asc`: a timeline reads oldest to newest. */
  order?: TimelineOrder
  include?: TimelineInclude
  limit?: number
  cursor?: string | null
}

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

/* ------------------------------------------------------------- cursor -- */

/**
 * Keyset cursor, the same construction the feed uses.
 *
 * `d` is the effective date the ORDER BY sorts on, not `published_at`, because
 * those differ for a document with no publication date and a predicate built
 * on the wrong one skips rows at every page boundary.
 */
interface TimelineCursor {
  o: TimelineOrder
  i: TimelineInclude
  d: string
  id: string
}

export function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

/**
 * Decode, or return null.
 *
 * A cursor from a different order or a different `include` describes a
 * position in a sequence that no longer exists, so it is discarded and the
 * timeline restarts. Same reasoning as decodeCursor in lib/queries/feed.ts: a
 * user can edit a query string, and an exception is a worse answer than the
 * first page.
 */
export function decodeTimelineCursor(
  raw: string | null | undefined,
  order: TimelineOrder,
  include: TimelineInclude,
): TimelineCursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as TimelineCursor
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.d !== "string") return null
    if (parsed.o !== order || parsed.i !== include) return null
    return parsed
  } catch {
    return null
  }
}

/* -------------------------------------------------------------- query -- */

interface TimelineRow {
  [column: string]: unknown
  id: string
  effective_date: string | Date
  date_is_approximate: boolean
  issue_tag: string
  topic_label: string | null
  topic_id: string | null
  previous_position: string | null
  position_text: string
  quote: string
  source_url: string
  source_name: string
  document_id: string
  document_title: string
  published_at: string | Date | null
  confidence_label: ConfidenceLabel
  presentation_mode: PresentationMode
  verify_yourself: boolean
  corroboration_count: number
  flags: InsightFlag[] | null
  prior_insight_id: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A speaker's stance history, shaped for direct rendering.
 *
 * Named for the product's word - candidate - and keyed on the data model's -
 * speaker - because they are the same thing seen from two sides, and the
 * difference is the bug this function exists not to have.
 */
export async function getCandidateTimeline(
  query: TimelineQuery,
): Promise<CandidateTimeline> {
  const order: TimelineOrder = query.order === "desc" ? "desc" : "asc"
  const include: TimelineInclude =
    query.include === "stance_changes" ? "stance_changes" : "flip_flops"

  const empty: CandidateTimeline = {
    speaker: null,
    entries: [],
    nextCursor: null,
    order,
    include,
    filters: { topicId: null, topicSlug: null, from: query.from ?? null, to: query.to ?? null },
  }

  // Same reasoning as the feed: someone working on the UI without database
  // access gets an empty timeline and a rendered empty state, not a crash.
  if (!hasDatabase) return empty
  if (!UUID_RE.test(query.speakerId)) return empty

  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT)
  const cursor = decodeTimelineCursor(query.cursor, order, include)

  const [speaker] = [
    ...(await db.execute<{
      [column: string]: unknown
      id: string
      name: string
      party: string | null
      role: string | null
    }>(sql`
      select id, name, party, role from speakers where id = ${query.speakerId}::uuid limit 1
    `)),
  ]
  if (!speaker) return empty

  const filters: SQL[] = []

  // `flags && array['FLIP_FLOP']` is an array-overlap test, answered by the
  // GIN index on insights.flags rather than by reading the speaker's rows.
  if (include === "flip_flops") {
    filters.push(sql`and i.flags && array['FLIP_FLOP']::insight_flag[]`)
  } else {
    filters.push(sql`and i.card_type = 'stance_change'`)
  }

  const topic = (query.topicId ?? "").trim()
  let topicSlug: string | null = null
  let topicUuid: string | null = null

  if (topic) {
    if (UUID_RE.test(topic)) {
      topicUuid = topic
      filters.push(sql`and exists (
        select 1 from insight_topics it
         where it.insight_id = i.id and it.topic_id = ${topic}::uuid
      )`)
    } else {
      topicSlug = topic
      // The primary column and the join table together, for the same reason
      // the feed's taggedWith checks both: rows written before insight_topics
      // existed carry only issue_tag, and a filter that skipped them would
      // look like a person's record going missing.
      filters.push(sql`and (
        i.issue_tag = ${topic}
        or exists (
          select 1 from insight_topics it
            join topics t on t.id = it.topic_id
           where it.insight_id = i.id and t.slug = ${topic}
        )
      )`)
    }
  }

  if (query.from) filters.push(sql`and ${EFFECTIVE_DATE} >= ${query.from.toISOString()}::timestamptz`)
  if (query.to) filters.push(sql`and ${EFFECTIVE_DATE} <= ${query.to.toISOString()}::timestamptz`)

  const direction = order === "asc" ? sql`asc` : sql`desc`
  const keyset = cursor
    ? order === "asc"
      ? sql`and (r.effective_date, r.id) > (${cursor.d}::timestamptz, ${cursor.id}::uuid)`
      : sql`and (r.effective_date, r.id) < (${cursor.d}::timestamptz, ${cursor.id}::uuid)`
    : sql``

  const rows = await db.execute<TimelineRow>(sql`
    with visible as (
      select
        i.id,
        ${EFFECTIVE_DATE} as effective_date,
        (d.published_at is null) as date_is_approximate,
        i.issue_tag,
        pt.label as topic_label,
        pt.id as topic_id,
        -- The previous position lives in the card's jsonb payload, which is
        -- not a queryable column anywhere else in this codebase. It is read
        -- here rather than filtered on, which is the line: ->> in a SELECT is
        -- a field read, ->> in a WHERE is an unindexed scan.
        i.payload ->> 'previousPosition' as previous_position,
        i.payload ->> 'priorInsightId' as prior_insight_id,
        i.position_text,
        substring(d.raw_text from i.quote_char_start + 1
                  for i.quote_char_end - i.quote_char_start) as quote,
        d.url as source_url,
        d.source_name,
        d.id as document_id,
        d.title as document_title,
        d.published_at,
        i.confidence_label,
        i.presentation_mode,
        i.verify_yourself,
        i.corroboration_count,
        i.flags
      from insights i
      join documents d on d.id = i.document_id
      left join insight_topics ipt on ipt.insight_id = i.id and ipt."primary"
      left join topics pt on pt.id = ipt.topic_id
      where i.speaker_id = ${query.speakerId}::uuid
        and i.status = 'published'
        -- Same guard the feed carries: a span past the end of its document
        -- means the text and the offsets disagree, and half a quote on a
        -- timeline is worse than one fewer entry.
        and i.quote_char_end <= length(d.raw_text)
        and i.quote_char_end > i.quote_char_start
        ${sql.join(filters, sql` `)}
    )
    select * from visible r
    where true ${keyset}
    order by r.effective_date ${direction}, r.id ${direction}
    limit ${limit + 1}
  `)

  const all = [...rows].map(toEntry)
  const entries = all.slice(0, limit)
  const hasMore = all.length > limit
  const last = entries[entries.length - 1]

  return {
    speaker: {
      id: speaker.id,
      name: speaker.name,
      party: speaker.party,
      role: speaker.role,
    },
    entries,
    order,
    include,
    filters: {
      topicId: topicUuid,
      topicSlug,
      from: query.from ?? null,
      to: query.to ?? null,
    },
    nextCursor:
      hasMore && last
        ? encodeTimelineCursor({
            o: order,
            i: include,
            d: last.date.toISOString(),
            id: last.id,
          })
        : null,
  }
}

/**
 * The date a timeline actually orders by.
 *
 * Spelled once and used in the SELECT, the date filters, and the ORDER BY. An
 * ORDER BY and a keyset predicate computing this two ways is a skipped row at
 * every page boundary where they disagree.
 */
const EFFECTIVE_DATE = sql`coalesce(d.published_at, i.created_at)`

function toEntry(row: TimelineRow): TimelineEntry {
  return {
    id: row.id,
    date: new Date(row.effective_date),
    dateIsApproximate: Boolean(row.date_is_approximate),
    topic: row.issue_tag,
    topicLabel: row.topic_label ?? row.issue_tag,
    topicId: row.topic_id,
    previousPosition: row.previous_position,
    currentPosition: row.position_text,
    quote: row.quote,
    sourceUrl: row.source_url,
    sourceName: row.source_name,
    documentId: row.document_id,
    documentTitle: row.document_title,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    confidenceLabel: row.confidence_label ?? "medium",
    presentationMode: row.presentation_mode ?? "stated",
    verifyYourself: row.verify_yourself ?? false,
    corroborationCount: Math.max(1, Number(row.corroboration_count ?? 1)),
    flags: row.flags ?? [],
    priorInsightId: row.prior_insight_id,
  }
}
