import { sql, type SQL } from "drizzle-orm"
import { db, hasDatabase } from "@/db"
import {
  isConfidenceLabel,
  type ConfidenceLabel,
  type PresentationMode,
} from "../confidence/score"
import { isInsightFlag, type FactCheckStatus, type InsightFlag } from "../flags/types"
import {
  CARD_TYPES,
  type Attribution,
  type CardType,
  type InsightPayload,
} from "../schemas/insight"
import { loadTopics } from "../topics/taxonomy"

/**
 * The feed query.
 *
 * Two properties this module exists to hold:
 *
 * 1. The quote is produced by slicing the stored document at the verified
 *    offsets. It is never read from a stored quote string, because no such
 *    column exists. Traceability is a property of the data model rather than a
 *    promise from the model.
 * 2. Cards that rest on the same words are collapsed into one card, in SQL,
 *    before the page limit applies. Collapsing in Node after the fact returns
 *    short pages and, with a cursor, an unstable one.
 *
 * raw_text stays on the server. Only the sliced span crosses to the client.
 */

/**
 * `saved` orders by when the reader saved the card, not by when it was
 * published, and is only meaningful together with `savedBy`. Asking for it
 * without one falls back to `recent` rather than erroring: a sort order is not
 * worth a failed request.
 */
export type FeedSort = "recent" | "relevant" | "saved" | "confidence" | "corroboration"

export type QuoteVerification = "exact" | "normalized" | "transcript" | "fuzzy"

/**
 * One card. The unified feed type across all four kinds of insight.
 *
 * `cardType` is the discriminator and `payload` carries whatever is specific
 * to that kind. Everything a card needs to render, including its provenance,
 * is on this object; there is no second fetch to show a source line.
 */
export interface FeedItem {
  id: string
  cardType: CardType
  /** Kind-specific fields. Narrow on cardType. */
  payload: InsightPayload
  /** The card's headline claim, whatever its kind. */
  headline: string
  plainLanguage: string
  /** Sliced out of the stored document at the verified offsets. */
  quote: string
  /** Character span in the source document, shown as provenance. */
  span: { start: number; end: number }
  /** Which rung located the quote. "fuzzy" means the quote was corrected. */
  quoteVerified: QuoteVerification
  /** 1 on the lossless rungs, the measured ratio on fuzzy. */
  quoteSimilarity: number | null
  /** The primary issue tag. Also present in `topics`. */
  issueTag: string
  /** Every issue this insight is tagged with, primary first. */
  topics: string[]
  attribution: Attribution
  /**
   * The single badge the first version of the card component reads.
   * Mirrors flags[0]. New code should read `flags`.
   */
  flag: InsightFlag | null
  /** Every badge this insight carries. May be empty. */
  flags: InsightFlag[]
  factCheckStatus: FactCheckStatus
  /**
   * How directly the quote supports this card's claim, 0 to 1.
   *
   * Null on a row written before the extractor was asked the question. A
   * client should branch on `presentationMode`, not on this number: the
   * threshold lives on the server precisely so it can move without a client
   * release. See lib/confidence/score.ts.
   */
  claimSupportConfidence: number | null
  /** The bucketed score. `low` is the one that changes how a card reads. */
  confidenceLabel: ConfidenceLabel
  /** True exactly when confidenceLabel is `low`. */
  verifyYourself: boolean
  /**
   * What the client may do with this card.
   *
   * `stated`       render the claim as written.
   * `nudge_verify` never as flatly stated fact: lead with the quote, show the
   *                check-it-yourself affordance, link the source.
   */
  presentationMode: PresentationMode
  /**
   * Independent sources reporting this insight, including this card's own.
   *
   * Always at least 1. `sources` is capped, so `count` can exceed its length;
   * a client showing "+3 more" reads the count, not the array.
   */
  sourceDiversity: {
    count: number
    sources: { sourceName: string; sourceUrl: string }[]
  }
  /**
   * The rewrite pass's sentence, or null when it did not run or did not
   * produce something usable. The card always has `quote` to fall back on.
   */
  plainLanguageSummary: string | null
  readingLevelEstimate: number | null
  /**
   * Whether this card matched the reader's selected topics.
   *
   * Returned so a caller can tell a boosted card from the tail without
   * re-deriving the match, and so "because you follow housing" can be shown
   * honestly rather than guessed at.
   */
  matchesInterests: boolean
  judgeRating: number | null
  relevanceScore: number
  /** null when the document names no one, which claims and risks often do. */
  candidateName: string | null
  /** Portrait with its reusable image license and source attribution. */
  candidatePhoto: {
    imageUrl: string
    filePage: string
    creator: string | null
    licenseName: string
    licenseUrl: string | null
  } | null
  /**
   * The person, not the ballot line. Null on an unattributed card and on rows
   * written before `speakers` existed. This is the id the timeline takes.
   */
  speakerId: string | null
  documentId: string
  documentTitle: string
  sourceName: string
  sourceUrl: string
  /** Lead image for the source document, when it has one. */
  imageUrl: string | null
  publishedAt: Date | null
  createdAt: Date
  isSynthetic: boolean
  /**
   * Other insights that cite this exact quote, collapsed into this card.
   *
   * Non-empty means the same words support more than one kind of insight, and
   * the feed is showing the most informative one rather than all of them.
   */
  alsoCited: { id: string; cardType: CardType }[]
  /** Convenience for the "position_text" name the older UI used. */
  positionText: string
  /** Set only on a saved-list query. When the reader saved this card. */
  savedAt: Date | null
}

/**
 * How a reader's selected topics affect the results.
 *
 * `boost` is the default and the better one for a feed someone scrolls: their
 * issues come first, and then everything else, so the app never silently
 * becomes the only three subjects they thought to tick during onboarding.
 * `strict` is for a deliberate "only show me these" toggle.
 */
export type TopicMode = "boost" | "strict"

export interface FeedQuery {
  limit?: number
  cursor?: string | null
  sort?: FeedSort
  /** Issue tags to restrict to. Empty or absent means all. */
  topics?: string[]
  /** Card types to restrict to. Empty or absent means all. */
  cardTypes?: CardType[]
  /** Restrict to one candidate, for a profile or timeline view. */
  candidateId?: string
  /**
   * The reader's chosen issues, as slugs. Resolved from a UserProfile by the
   * caller: this module takes slugs and does not know what a user is.
   */
  selectedTopics?: string[]
  /** What selectedTopics does. Default "boost". */
  topicMode?: TopicMode
  /** Restrict to insights carrying at least one of these badges. */
  flags?: InsightFlag[]
  /** Restrict to these confidence labels. Empty or absent means all. */
  confidenceLabels?: ConfidenceLabel[]
  /**
   * `true` for only the cards that need a verify-yourself nudge, `false` for
   * only the ones that do not. Absent means both, which is the feed.
   */
  verifyYourself?: boolean
  /** Only insights confirmed by at least this many independent sources. */
  minCorroboration?: number
  /** Restrict to one person, across every race and every spelling of a name. */
  speakerId?: string
  /** How many corroborating sources to inline per card. Default 3, max 10. */
  sourceDiversityLimit?: number
  /**
   * Restrict to one reader's saved insights.
   *
   * Implemented as a join rather than a second query so the saved list gets
   * the same quote slicing, same-quote collapsing, and cursor pagination as
   * the main feed, from one definition.
   */
  savedBy?: string
}

export interface FeedPage {
  items: FeedItem[]
  /** Pass back as `cursor` for the next page. null means the run is over. */
  nextCursor: string | null
  sort: FeedSort
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

/** "saved" without a reader has nothing to order by, so it degrades to recent. */
function resolveSort(query: FeedQuery): FeedSort {
  if (query.sort === "relevant") return "relevant"
  if (query.sort === "confidence") return "confidence"
  if (query.sort === "corroboration") return "corroboration"
  if (query.sort === "saved" && query.savedBy) return "saved"
  return "recent"
}

/* ------------------------------------------------------------- cursor -- */

interface Cursor {
  s: FeedSort
  /** relevance_score, only on the relevant sort. */
  r?: number
  /**
   * The leading numeric term of the confidence and corroboration sorts.
   *
   * Same reason `r` exists: a keyset predicate has to compare against the
   * exact tuple the ORDER BY uses, and a sort whose first term is missing from
   * the cursor hands back the top of the list again at every page boundary.
   */
  n?: number
  /** created_at, ISO. */
  t: string
  id: string
  /**
   * The topic-match bucket, 1 or 0, present only when boosting.
   *
   * Part of the cursor because it is the first term of the ORDER BY. A keyset
   * predicate that omitted it would compare against the wrong tuple and hand
   * back the boosted rows again once the boosted section ran out.
   */
  b?: number
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

/**
 * Decode a cursor, or return null.
 *
 * A malformed or stale cursor returns the first page rather than throwing. It
 * arrives from a query string, so a user can edit it, and an exception on a
 * feed request is a worse answer than starting over.
 */
export function decodeCursor(raw: string | null | undefined, sort: FeedSort): Cursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.t !== "string") return null
    // A cursor from a different sort order describes a position in a sequence
    // that no longer exists. Ignoring it restarts the feed, which is right.
    if (parsed.s !== sort) return null
    return parsed
  } catch {
    return null
  }
}

/* -------------------------------------------------------------- query -- */

interface FeedRow {
  // drizzle's execute<T> requires an index signature on the row shape.
  [column: string]: unknown

  id: string
  card_type: CardType
  payload: InsightPayload | null
  position_text: string
  plain_language: string
  issue_tag: string
  attribution: Attribution
  flag: FeedItem["flag"]
  judge_rating: number | null
  relevance_score: number
  quote: string
  quote_char_start: number
  quote_char_end: number
  quote_verified: QuoteVerification
  quote_similarity: number | null
  topics: string[] | null
  flags: InsightFlag[] | null
  fact_check_status: FactCheckStatus
  claim_support_confidence: number | null
  confidence_label: ConfidenceLabel
  verify_yourself: boolean
  presentation_mode: PresentationMode
  corroboration_count: number
  corroborating_sources: { sourceName: string; sourceUrl: string }[] | null
  confidence_sort: number
  plain_language_summary: string | null
  reading_level_estimate: number | null
  topic_boost: number
  speaker_id: string | null
  candidate_name: string | null
  candidate_photo_url: string | null
  candidate_photo_file_page: string | null
  candidate_photo_creator: string | null
  candidate_photo_license_name: string | null
  candidate_photo_license_url: string | null
  document_id: string
  document_title: string
  source_name: string
  source_url: string
  image_url: string | null
  published_at: string | Date | null
  created_at: string | Date
  is_synthetic: boolean
  saved_at: string | Date | null
  siblings: { id: string; cardType: CardType }[] | null
}

/**
 * Which card wins when several rest on the same quote.
 *
 * A flip-flop and a stance on the same words should surface as the flip-flop:
 * same evidence, more informative framing. Kept in SQL so the collapse happens
 * before the page limit.
 */
const CARD_PRIORITY_SQL = sql`case i.card_type
  when 'stance_change' then 0
  when 'voter_relevance' then 1
  when 'stance' then 2
  else 3 end`

export async function getInsightFeed(query: FeedQuery = {}): Promise<FeedPage> {
  const sort = resolveSort(query)

  // Someone working on the UI may not be in the Neon org yet. Return an empty
  // feed so the page renders its empty state instead of crashing the dev
  // server with a connection error.
  if (!hasDatabase) return { items: [], nextCursor: null, sort }

  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT)
  const cursor = decodeCursor(query.cursor, sort)

  // Unknown values are dropped rather than passed through: an unknown tag is a
  // filter that matches nothing anyway, and card types interpolate into an
  // enum comparison. The topic vocabulary is read from the table rather than
  // from a constant, so a newly seeded topic is filterable immediately.
  const vocabulary = new Set((await loadTopics()).map((t) => t.slug))
  const topics = (query.topics ?? []).filter((t) => vocabulary.has(t))
  const selectedTopics = [
    ...new Set((query.selectedTopics ?? []).filter((t) => vocabulary.has(t))),
  ]
  const cardTypes = (query.cardTypes ?? []).filter((t) =>
    (CARD_TYPES as readonly string[]).includes(t),
  )
  const flags = (query.flags ?? []).filter(isInsightFlag)
  const confidenceLabels = [
    ...new Set((query.confidenceLabels ?? []).filter(isConfidenceLabel)),
  ]
  const sourceDiversityLimit = Math.min(Math.max(1, query.sourceDiversityLimit ?? 3), 10)

  const topicMode: TopicMode = query.topicMode === "strict" ? "strict" : "boost"
  // Boosting with nothing selected is just the normal feed, and carrying a
  // constant 0 through the ORDER BY and the cursor would be dead weight.
  const boosting = selectedTopics.length > 0 && topicMode === "boost"

  // Built as `in (...)` with one bind per value. Passing the array itself to
  // `any()` binds it as a single scalar and Postgres rejects it as a malformed
  // array literal, which is a 500 rather than an empty page.
  const filters: SQL[] = []
  if (topics.length > 0) filters.push(sql`and ${taggedWith(topics)}`)
  if (cardTypes.length > 0) filters.push(sql`and i.card_type::text in ${values(cardTypes)}`)
  if (query.candidateId) filters.push(sql`and i.candidate_id = ${query.candidateId}::uuid`)
  // Array overlap: "carries at least one of these badges", answered by the GIN
  // index on insights.flags.
  if (flags.length > 0) {
    const list = sql.join(
      flags.map((f) => sql`${f}`),
      sql`, `,
    )
    filters.push(sql`and i.flags && array[${list}]::insight_flag[]`)
  }
  if (confidenceLabels.length > 0) {
    filters.push(sql`and i.confidence_label::text in ${values(confidenceLabels)}`)
  }
  // An explicit false is a filter for "only the confident ones", which is not
  // the same as leaving it out. `!== undefined` rather than a truthiness test.
  if (query.verifyYourself !== undefined) {
    filters.push(sql`and i.verify_yourself = ${query.verifyYourself}`)
  }
  if (query.minCorroboration !== undefined && query.minCorroboration > 1) {
    filters.push(sql`and i.corroboration_count >= ${Math.floor(query.minCorroboration)}`)
  }
  // The person, not the ballot line, so a speaker filter spans every race and
  // every spelling of their name. `candidateId` is kept and still works.
  if (query.speakerId) filters.push(sql`and i.speaker_id = ${query.speakerId}::uuid`)
  // Strict mode is a filter; boost mode is an ordering term computed below.
  if (selectedTopics.length > 0 && topicMode === "strict") {
    filters.push(sql`and ${taggedWith(selectedTopics)}`)
  }

  // An inner join, so a saved-list query returns only saved cards and the
  // same-quote collapse never picks an unsaved sibling as the survivor.
  const savedJoin = query.savedBy
    ? sql`join saved_insights sv on sv.insight_id = i.id and sv.user_id = ${query.savedBy}`
    : sql``
  const savedAt = query.savedBy ? sql`sv.saved_at` : sql`null::timestamptz`

  const boost = boosting
    ? sql`case when ${taggedWith(selectedTopics)} then 1 else 0 end`
    : sql`0`

  /**
   * The numeric term the confidence and corroboration sorts lead with.
   *
   * `claim_support_confidence` falls back to `extractor_confidence` so a row
   * written before the column existed sorts by the rating it does have rather
   * than sinking to the bottom of every confidence-ordered page. Spelled once
   * here and referenced by name afterwards, because an ORDER BY and its keyset
   * predicate that compute the same value two ways is a page boundary bug
   * waiting for the first row where they disagree.
   */
  const confidenceSort = sql`coalesce(i.claim_support_confidence, i.extractor_confidence, 0)`

  const keyset = buildKeyset(sort, cursor, boosting)
  // The boost bucket leads the sort, so a reader's issues come first and the
  // rest of the feed follows in its normal order rather than disappearing.
  const boostOrder = boosting ? sql`r.topic_boost desc, ` : sql``
  const ordering =
    sort === "relevant"
      ? sql`order by ${boostOrder}r.relevance_score desc, r.created_at desc, r.id desc`
      : sort === "confidence"
        ? sql`order by ${boostOrder}r.confidence_sort desc, r.created_at desc, r.id desc`
        : sort === "corroboration"
          ? sql`order by ${boostOrder}r.corroboration_count desc, r.created_at desc, r.id desc`
          : sort === "saved"
            ? sql`order by ${boostOrder}r.saved_at desc, r.id desc`
            : sql`order by ${boostOrder}r.created_at desc, r.id desc`

  const rows = await db.execute<FeedRow>(sql`
    with visible as (
      select
        i.id,
        i.card_type,
        i.payload,
        i.position_text,
        i.plain_language,
        i.issue_tag,
        i.attribution,
        i.flag,
        i.judge_rating,
        i.relevance_score,
        i.quote_char_start,
        i.quote_char_end,
        i.quote_verified,
        i.quote_similarity,
        i.flags,
        i.fact_check_status,
        i.plain_language_summary,
        i.reading_level_estimate,
        i.claim_support_confidence,
        i.confidence_label,
        i.verify_yourself,
        i.presentation_mode,
        i.corroboration_count,
        i.speaker_id,
        i.created_at,
        ${confidenceSort} as confidence_sort,
        ${boost} as topic_boost,
        -- The corroborating outlets, inline, so a card can render "3 sources"
        -- with names and links without a second round trip per card. DISTINCT
        -- ON collapses two articles from one outlet to one entry, which is the
        -- same rule the stored count uses.
        coalesce(
          (select json_agg(json_build_object(
                    'sourceName', s.source_name,
                    'sourceUrl', s.source_url))
             from (
               select distinct on (ic.source_key) cd.source_name, cd.url as source_url
                 from insight_corroborations ic
                 join documents cd on cd.id = ic.document_id
                where ic.insight_id = i.id
                order by ic.source_key, cd.published_at desc nulls last
                limit ${sourceDiversityLimit}
             ) s),
          '[]'::json
        ) as corroborating_sources,
        coalesce(
          (select array_agg(t.slug order by it."primary" desc, t.sort_order)
             from insight_topics it
             join topics t on t.id = it.topic_id
            where it.insight_id = i.id),
          array[i.issue_tag]
        ) as topics,
        substring(d.raw_text from i.quote_char_start + 1
                  for i.quote_char_end - i.quote_char_start) as quote,
        c.name as candidate_name,
        cp.image_url as candidate_photo_url,
        cp.file_page as candidate_photo_file_page,
        cp.creator as candidate_photo_creator,
        cp.license_name as candidate_photo_license_name,
        cp.license_url as candidate_photo_license_url,
        d.id as document_id,
        d.title as document_title,
        d.source_name,
        d.url as source_url,
        d.image_url,
        d.published_at,
        d.is_synthetic,
        ${savedAt} as saved_at,
        ${CARD_PRIORITY_SQL} as card_priority
      from insights i
      join documents d on d.id = i.document_id
      left join candidates c on c.id = i.candidate_id
      left join candidate_photos cp on cp.candidate_id = i.candidate_id
      ${savedJoin}
      where i.status = 'published'
        -- An offset past the end of the document means the stored text and the
        -- stored span disagree. Drop the card rather than render a half quote.
        and i.quote_char_end <= length(d.raw_text)
        and i.quote_char_end > i.quote_char_start
        ${sql.join(filters, sql` `)}
    ),
    grouped as (
      select
        v.*,
        row_number() over (
          partition by v.document_id, v.quote_char_start, v.quote_char_end
          order by v.card_priority, v.relevance_score desc, v.id
        ) as rn,
        json_agg(json_build_object('id', v.id, 'cardType', v.card_type)) over (
          partition by v.document_id, v.quote_char_start, v.quote_char_end
        ) as siblings
      from visible v
    )
    select r.id, r.card_type, r.payload, r.position_text, r.plain_language,
           r.plain_language_summary, r.reading_level_estimate,
           r.issue_tag, r.topics, r.attribution, r.flag, r.flags,
           r.fact_check_status, r.topic_boost,
           r.claim_support_confidence, r.confidence_label, r.verify_yourself,
           r.presentation_mode, r.corroboration_count, r.corroborating_sources,
           r.confidence_sort, r.speaker_id,
           r.judge_rating, r.relevance_score,
           r.quote, r.quote_char_start, r.quote_char_end, r.quote_verified,
           r.quote_similarity, r.candidate_name, r.candidate_photo_url,
           r.candidate_photo_file_page, r.candidate_photo_creator,
           r.candidate_photo_license_name, r.candidate_photo_license_url,
           r.document_id, r.document_title,
           r.source_name, r.source_url, r.image_url, r.published_at, r.created_at,
           r.is_synthetic, r.saved_at, r.siblings
    from grouped r
    where r.rn = 1
      ${keyset}
    ${ordering}
    limit ${limit + 1}
  `)

  const all = [...rows].map(toFeedItem)

  // One row over the page size answers "is there more" without a count query.
  const items = all.slice(0, limit)
  const hasMore = all.length > limit
  const last = items[items.length - 1]

  return {
    items,
    sort,
    nextCursor:
      hasMore && last
        ? encodeCursor({
            s: sort,
            r: sort === "relevant" ? last.relevanceScore : undefined,
            n:
              sort === "confidence"
                ? (last.claimSupportConfidence ?? 0)
                : sort === "corroboration"
                  ? last.sourceDiversity.count
                  : undefined,
            b: boosting ? (last.matchesInterests ? 1 : 0) : undefined,
            // The cursor's timestamp is whichever column the sort reads.
            t: (sort === "saved" ? (last.savedAt ?? last.createdAt) : last.createdAt).toISOString(),
            id: last.id,
          })
        : null,
  }
}

/**
 * The keyset predicate.
 *
 * Row-value comparison against the same tuple the ORDER BY uses, which is what
 * makes the page boundary exact. An OFFSET here would skip or repeat a card
 * every time a new insight is inserted mid-scroll.
 */
/** A parenthesised, fully parameterised value list for an IN clause. */
function values(items: string[]): SQL {
  return sql`(${sql.join(
    items.map((item) => sql`${item}`),
    sql`, `,
  )})`
}

function buildKeyset(sort: FeedSort, cursor: Cursor | null, boosting: boolean): SQL {
  if (!cursor) return sql``

  // The tuple must match the ORDER BY exactly, boost bucket included, or the
  // page boundary lands in the wrong section of the sort and the boosted rows
  // come back a second time once the boosted section runs out.
  const boostTerm = boosting ? sql`r.topic_boost, ` : sql``
  const boostValue = boosting ? sql`${cursor.b ?? 0}::int, ` : sql``

  if (sort === "relevant") {
    return sql`and (${boostTerm}r.relevance_score, r.created_at, r.id)
               < (${boostValue}${cursor.r ?? 0}::real, ${cursor.t}::timestamptz, ${cursor.id}::uuid)`
  }

  if (sort === "confidence") {
    return sql`and (${boostTerm}r.confidence_sort, r.created_at, r.id)
               < (${boostValue}${cursor.n ?? 0}::real, ${cursor.t}::timestamptz, ${cursor.id}::uuid)`
  }

  if (sort === "corroboration") {
    return sql`and (${boostTerm}r.corroboration_count, r.created_at, r.id)
               < (${boostValue}${cursor.n ?? 0}::int, ${cursor.t}::timestamptz, ${cursor.id}::uuid)`
  }

  if (sort === "saved") {
    return sql`and (${boostTerm}r.saved_at, r.id)
               < (${boostValue}${cursor.t}::timestamptz, ${cursor.id}::uuid)`
  }

  return sql`and (${boostTerm}r.created_at, r.id)
             < (${boostValue}${cursor.t}::timestamptz, ${cursor.id}::uuid)`
}

/**
 * "This insight carries at least one of these tags."
 *
 * Checks the primary column and the join table together. The primary tag is
 * mirrored into insight_topics at write time, so the join alone would normally
 * be enough - but rows written before that table existed carry only issue_tag,
 * and a topic filter that silently skipped them would look like data loss.
 */
function taggedWith(slugs: string[]): SQL {
  return sql`(
    i.issue_tag in ${values(slugs)}
    or exists (
      select 1 from insight_topics it
      join topics t on t.id = it.topic_id
      where it.insight_id = i.id and t.slug in ${values(slugs)}
    )
  )`
}

function normalizePayload(row: FeedRow): InsightPayload {
  const payload = row.payload
  if (payload && typeof payload === "object" && "cardType" in payload) {
    return payload as InsightPayload
  }
  return { ...(payload ?? {}), cardType: row.card_type } as InsightPayload
}

function toFeedItem(row: FeedRow): FeedItem {
  const siblings = (row.siblings ?? []).filter((s) => s.id !== row.id)

  return {
    id: row.id,
    cardType: row.card_type,
    // Rows written before the payload column existed carry `{}`, so the
    // discriminator is restored from the column that always has it. A card
    // whose payload does not name its own kind is not narrowable by a caller.
    payload: normalizePayload(row),
    headline: row.position_text,
    positionText: row.position_text,
    plainLanguage: row.plain_language,
    quote: row.quote,
    span: { start: row.quote_char_start, end: row.quote_char_end },
    quoteVerified: row.quote_verified,
    quoteSimilarity: row.quote_similarity,
    issueTag: row.issue_tag,
    topics: row.topics ?? [row.issue_tag],
    attribution: row.attribution,
    flag: row.flag,
    flags: row.flags ?? [],
    factCheckStatus: row.fact_check_status ?? "unresolved",
    claimSupportConfidence: row.claim_support_confidence,
    confidenceLabel: row.confidence_label ?? "medium",
    verifyYourself: row.verify_yourself ?? false,
    presentationMode: row.presentation_mode ?? "stated",
    sourceDiversity: {
      // Floor of 1 rather than 0: every insight came from somewhere, and a 0
      // here would make "one source" and "not yet scanned" look the same to a
      // client. A row the corroboration pass has never touched still has one.
      count: Math.max(1, Number(row.corroboration_count ?? 1)),
      sources: row.corroborating_sources ?? [],
    },
    plainLanguageSummary: row.plain_language_summary,
    readingLevelEstimate: row.reading_level_estimate,
    matchesInterests: Number(row.topic_boost) === 1,
    judgeRating: row.judge_rating,
    relevanceScore: row.relevance_score,
    candidateName: row.candidate_name,
    candidatePhoto: row.candidate_photo_url && row.candidate_photo_file_page && row.candidate_photo_license_name
      ? {
          imageUrl: row.candidate_photo_url,
          filePage: row.candidate_photo_file_page,
          creator: row.candidate_photo_creator,
          licenseName: row.candidate_photo_license_name,
          licenseUrl: row.candidate_photo_license_url,
        }
      : null,
    speakerId: row.speaker_id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    imageUrl: row.image_url,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    createdAt: new Date(row.created_at),
    isSynthetic: row.is_synthetic,
    savedAt: row.saved_at ? new Date(row.saved_at) : null,
    alsoCited: siblings,
  }
}

/**
 * The flat, unpaginated feed the first version of the UI consumes.
 *
 * Kept as-is so the card component does not have to change on the same day the
 * data layer does. New surfaces should call getInsightFeed and page properly.
 */
export async function getFeed(limit = 40): Promise<FeedItem[]> {
  const page = await getInsightFeed({ limit: Math.min(limit, MAX_LIMIT) })
  return page.items.filter((item) => item.quote.trim().length > 0)
}
