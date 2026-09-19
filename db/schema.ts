import { sql } from "drizzle-orm"
import {
  pgTable,
  jsonb,
  pgEnum,
  uuid,
  text,
  integer,
  real,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"

/* enums */

export const districtLevel = pgEnum("district_level", ["federal", "state", "local"])
export const mediaType = pgEnum("media_type", ["article", "transcript"])
export const attribution = pgEnum("attribution", ["own_words", "characterization"])

/**
 * The "what changed" badges.
 *
 * A Postgres enum rather than free text, and extended by migration rather than
 * by an application writing a new string: the feed filters on these values, so
 * a typo'd flag would be a badge that exists in the table and matches no
 * filter. Adding a value is `ALTER TYPE ... ADD VALUE`, which is why the
 * application reads the vocabulary from lib/flags/types.ts and never hardcodes
 * a literal at a call site.
 */
export const insightFlag = pgEnum("insight_flag", ["NEW", "FLIP_FLOP", "UNVERIFIED_CLAIM"])

/**
 * Where a factual claim stands against an external checker.
 *
 * Every claim starts `unresolved` and stays there until a FactCheckProvider
 * says otherwise. `unresolved` is therefore the honest default rather than a
 * placeholder: nothing has checked it, and the UNVERIFIED_CLAIM flag says so.
 */
export const factCheckStatus = pgEnum("fact_check_status", [
  "unresolved",
  "supported",
  "disputed",
  "false",
])

/**
 * The feed discriminator. One table, four kinds of card.
 *
 * They share a document, a candidate, a topic, and a verified quote span, and
 * differ only in a small jsonb payload. Splitting them into four tables would
 * mean a four-way union on every feed page for no gain.
 */
export const insightCardType = pgEnum("insight_card_type", [
  "stance",
  "stance_change",
  "factual_claim",
  "voter_relevance",
])

/**
 * Which rung of the verification ladder located this quote.
 *
 * There is deliberately no "failed" value. An item whose quote cannot be
 * located is not written here at all, it goes to `rejections`, because a row
 * in this table is by definition something that may be shown to a user.
 */
export const quoteVerification = pgEnum("quote_verified", [
  "exact",
  "normalized",
  "transcript",
  "fuzzy",
])
export const insightStatus = pgEnum("insight_status", [
  "published",
  "verify_yourself",
  "rejected",
])
export const reactionKind = pgEnum("reaction_kind", [
  "helpful",
  "not_helpful",
  "changed_my_mind",
  "looks_wrong",
])
export const moderationStatus = pgEnum("moderation_status", ["publish", "hold", "reject"])

/* ballot */

export const districts = pgTable(
  "districts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(), // congressional | state_house | city_council | ...
    name: text("name").notNull(),
    state: text("state").notNull(),
    geoId: text("geo_id").notNull(),
  },
  (t) => [uniqueIndex("districts_geo_id_key").on(t.geoId)],
)

export const races = pgTable(
  "races",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    districtId: uuid("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "cascade" }),
    office: text("office").notNull(),
    electionDate: timestamp("election_date", { withTimezone: true }).notNull(),
    level: districtLevel("level").notNull(),
  },
  (t) => [index("races_district_idx").on(t.districtId)],
)

export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raceId: uuid("race_id")
      .notNull()
      .references(() => races.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    party: text("party"),
    incumbent: boolean("incumbent").notNull().default(false),
  },
  (t) => [index("candidates_race_idx").on(t.raceId)],
)

/* topics */

/**
 * The issue taxonomy, as data rather than as a type.
 *
 * Deliberately a table and not a pgEnum. Three things need to add an issue
 * without a deploy: a new election cycle's vocabulary, a user picking what
 * they care about, and the extractor tagging something we had not thought of.
 * A pgEnum would make each of those a migration.
 *
 * `slug` is the join key everywhere, including against the older
 * insights.issue_tag text column, so the seed list must keep using the same
 * spellings that column already holds. See lib/topics/taxonomy.ts.
 */
export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    /** One line, shown next to the checkbox on the topic picker. */
    description: text("description").notNull().default(""),
    /** Display order on the picker. Ties fall back to label. */
    sortOrder: integer("sort_order").notNull().default(100),
    /**
     * Retired topics stay in the table so existing insight rows keep resolving;
     * they are just no longer offered as a pick.
     */
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("topics_slug_key").on(t.slug), index("topics_active_idx").on(t.active)],
)

/* documents */

/**
 * rawText is the load-bearing column in this schema.
 *
 * Insight quotes are stored as character offsets into this exact string, never
 * as quote text. If this value is ever re-fetched, re-normalized, or trimmed in
 * place, every offset pointing into it silently starts resolving to the wrong
 * span. Treat a stored document as immutable. Re-ingesting a changed page means
 * a new row, not an update.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    url: text("url").notNull(),
    sourceType: text("source_type").notNull(), // rss | gdelt | transcript | user
    sourceName: text("source_name").notNull(),
    title: text("title").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    rawText: text("raw_text").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    mediaType: mediaType("media_type").notNull(),
    durationSeconds: integer("duration_seconds"), // transcripts only
    isSynthetic: boolean("is_synthetic").notNull().default(false),
    submittedByUser: text("submitted_by_user"), // session_id of community submitter
    /**
     * Whatever the adapter saw and did not normalize, kept verbatim.
     *
     * Nothing in the pipeline reads it. It exists so a field we did not think
     * to normalize is not lost, and so a source can be debugged after the fact
     * without re-fetching a page that may have changed since.
     */
    rawMetadata: jsonb("raw_metadata").notNull().default({}),
  },
  (t) => [
    uniqueIndex("documents_url_key").on(t.url),
    index("documents_published_idx").on(t.publishedAt),
  ],
)

/* insights */

/**
 * quoteCharStart / quoteCharEnd are NOT NULL by design.
 *
 * Verification runs before a row is ever written here, so an insight without
 * resolvable offsets is not an insight. Making these nullable would let a
 * failed verification survive as a half-record that some later query renders.
 * A quote that fails the ladder is discarded and logged to rejections.
 *
 * Offsets index into documents.rawText, never into a normalized copy.
 */
export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /**
     * Nullable, unlike the other kinds of provenance here.
     *
     * A factual claim or a voter-relevant risk is often carried by a document
     * that names no candidate at all. Forcing a candidate row for those would
     * mean inventing a speaker, which is worse than storing none.
     */
    candidateId: uuid("candidate_id").references(() => candidates.id, {
      onDelete: "cascade",
    }),
    /** Which of the four card kinds this row is. See insightCardType. */
    cardType: insightCardType("card_type").notNull().default("stance"),
    issueTag: text("issue_tag").notNull(),
    /**
     * The card's headline claim, whatever its kind: the stance, the position
     * after a change, the claim text, or the described risk.
     */
    positionText: text("position_text").notNull(),
    plainLanguage: text("plain_language").notNull(),
    /**
     * The rewrite pass's output. Nullable on purpose.
     *
     * It comes from a second model call that runs after verification, and that
     * call is allowed to fail. Null means "no rewrite yet", and every read path
     * falls back to the verified quote, which is the thing that actually has to
     * be right. Never make this NOT NULL: doing so would make a failed rewrite
     * able to block an insight that is otherwise fully verified.
     */
    plainLanguageSummary: text("plain_language_summary"),
    /** Grade level the rewrite pass self-reports, roughly 6 to 8. */
    readingLevelEstimate: real("reading_level_estimate"),
    /**
     * Card-type specific fields, validated by the Zod payload union before
     * insert. Deliberately not queried: anything the feed filters or sorts on
     * is a real column.
     */
    payload: jsonb("payload").notNull().default({}),
    quoteCharStart: integer("quote_char_start").notNull(),
    quoteCharEnd: integer("quote_char_end").notNull(),
    /** Which rung located the quote. Never null, never "failed". */
    quoteVerified: quoteVerification("quote_verified").notNull().default("exact"),
    /** 1 on the lossless rungs, the measured ratio on the fuzzy rung. */
    quoteSimilarity: real("quote_similarity"),
    timestampStart: real("timestamp_start"), // transcripts only, seconds
    timestampEnd: real("timestamp_end"),
    attribution: attribution("attribution").notNull(),
    /**
     * The single badge the first version of the UI reads. Kept as a mirror of
     * flags[0] so that card component does not have to change on the same day
     * the data layer does. New code reads `flags`.
     */
    flag: insightFlag("flag"),
    /**
     * Every badge this insight carries, assigned at write time.
     *
     * A real column rather than a read-time derivation, because the feed has to
     * filter and sort on it: deriving NEW at read time would mean asking, for
     * every row on every page, whether any earlier row exists for the same
     * speaker and topic. Stored, that is a GIN index lookup.
     *
     * The cost of storing it is that a flag is a fact about what was known when
     * the row was written. NEW in particular is never recomputed: an insight
     * that was the first of its kind stays flagged NEW even once later ones
     * arrive, which is what a reader scrolling the feed means by "new".
     */
    flags: insightFlag("flags")
      .array()
      .notNull()
      .default(sql`'{}'::insight_flag[]`),
    /**
     * External fact-check verdict. See lib/flags/fact-check.ts.
     *
     * Only meaningful for factual_claim cards; other card types carry the
     * `unresolved` default and nothing reads it.
     */
    factCheckStatus: factCheckStatus("fact_check_status").notNull().default("unresolved"),
    /** Which provider produced the verdict, null while unresolved. */
    factCheckSource: text("fact_check_source"),
    factCheckedAt: timestamp("fact_checked_at", { withTimezone: true }),
    extractorConfidence: real("extractor_confidence"),
    judgeRating: integer("judge_rating"), // Nemotron, 0 to 3
    /**
     * Static ranking weight, computed once at persist time.
     *
     * Static on purpose: a score that decays with age would reshuffle the
     * ordering between two page requests, and a keyset cursor over a moving
     * sort skips and repeats rows. Recency is applied as a separate sort.
     */
    relevanceScore: real("relevance_score").notNull().default(0),
    status: insightStatus("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("insights_candidate_issue_idx").on(t.candidateId, t.issueTag),
    index("insights_document_idx").on(t.documentId),
    index("insights_status_idx").on(t.status),
    // Keyset pagination reads these in order; without them the feed sorts the
    // whole table on every page.
    index("insights_feed_recent_idx").on(t.createdAt, t.id),
    index("insights_feed_relevance_idx").on(t.relevanceScore, t.id),
    // `flags && '{FLIP_FLOP}'` is an array-overlap test, which only an
    // inverted index can answer without reading every row.
    index("insights_flags_idx").using("gin", t.flags),
    /**
     * One card of a given kind per quote span per document.
     *
     * This is the dedup floor. Re-running extraction over a document it has
     * already seen, or a model returning the same quote twice in one response,
     * cannot produce two identical cards. Collapsing ACROSS kinds happens in
     * the feed query, because those rows are legitimately different insights
     * that happen to share evidence.
     */
    uniqueIndex("insights_dedup_key").on(
      t.documentId,
      t.quoteCharStart,
      t.quoteCharEnd,
      t.cardType,
    ),
  ],
)

export const stanceLinks = pgTable(
  "stance_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insights.id, { onDelete: "cascade" }),
    priorInsightId: uuid("prior_insight_id")
      .notNull()
      .references(() => insights.id, { onDelete: "cascade" }),
    relation: text("relation").notNull(), // contradicts | refines | repeats
  },
  (t) => [index("stance_links_insight_idx").on(t.insightId)],
)

/**
 * Which issues an insight belongs to.
 *
 * Many-to-many, unlike insights.issue_tag, which is one text column and stays
 * as the primary tag. A rent-freeze proposal is genuinely both `housing` and
 * `economy`, and forcing the extractor to pick one is what makes a personal
 * feed miss things the reader asked for. issue_tag is mirrored in here as one
 * of the rows, so a query can join this table alone and never consult both.
 */
export const insightTopics = pgTable(
  "insight_topics",
  {
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insights.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    /** True for the one that also sits in insights.issue_tag. */
    primary: boolean("primary").notNull().default(false),
  },
  (t) => [
    uniqueIndex("insight_topics_key").on(t.insightId, t.topicId),
    // The personal feed reads this direction: "insights in these topics".
    index("insight_topics_topic_idx").on(t.topicId),
  ],
)

/* users */

/**
 * A reader's saved issue picks.
 *
 * `userId` is the same anonymous session string reactions and comments use.
 * There is no account system here, and this table does not invent one: it
 * stores preferences against whatever identifier the caller presents. Swapping
 * in real auth means changing what is written into this column, not the shape
 * of anything that reads it.
 */
export const userProfiles = pgTable(
  "user_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_profiles_user_key").on(t.userId)],
)

/**
 * The 2-to-3 topics a reader picked.
 *
 * The count bound is enforced at the API layer rather than by a constraint
 * here, because "at least two" is a rule about a completed onboarding flow,
 * not about a row. A check constraint would make the first insert of a
 * two-topic pair fail on its own.
 */
export const profileTopics = pgTable(
  "profile_topics",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => userProfiles.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    /** Picker order, so the UI can show them back the way they chose. */
    rank: integer("rank").notNull().default(0),
  },
  (t) => [
    uniqueIndex("profile_topics_key").on(t.profileId, t.topicId),
    index("profile_topics_profile_idx").on(t.profileId),
  ],
)

/**
 * Swipe-to-save.
 *
 * The unique index is the idempotency guarantee, not application code: a
 * double-tap, a retried request, and two tabs all land on the same row.
 * `savedAt` is deliberately not refreshed on a repeat save, so the list keeps
 * the order the reader actually saved things in.
 */
export const savedInsights = pgTable(
  "saved_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insights.id, { onDelete: "cascade" }),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("saved_insights_key").on(t.userId, t.insightId),
    // The list view: one user's saves, newest first.
    index("saved_insights_user_idx").on(t.userId, t.savedAt),
  ],
)

/**
 * Rendered share cards, cached by (insight, template).
 *
 * Generation is deterministic given those two, so a second request for the
 * same card returns the stored bytes instead of re-rendering. That is also the
 * rate limit: the expensive path runs once per card, not once per share.
 *
 * `body` is text because the default renderer emits SVG. A raster renderer
 * stores base64 and sets contentType accordingly; the serving route reads
 * `encoding` and does not care which.
 */
export const shareImages = pgTable(
  "share_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insights.id, { onDelete: "cascade" }),
    /** Bumped when the template changes, which invalidates the cache. */
    template: text("template").notNull(),
    contentType: text("content_type").notNull(),
    /** "utf8" for SVG, "base64" for raster formats. */
    encoding: text("encoding").notNull().default("utf8"),
    body: text("body").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("share_images_key").on(t.insightId, t.template),
    index("share_images_insight_idx").on(t.insightId),
  ],
)

/* social */

export const reactions = pgTable(
  "reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insights.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    kind: reactionKind("kind").notNull(),
  },
  (t) => [
    // one reaction of a given kind per session per insight
    uniqueIndex("reactions_unique").on(t.insightId, t.sessionId, t.kind),
    index("reactions_insight_idx").on(t.insightId),
  ],
)

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insights.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    body: text("body").notNull(),
    // holds by default, so an unmoderated comment can never leak into a read
    moderationStatus: moderationStatus("moderation_status").notNull().default("hold"),
    moderationReason: text("moderation_reason"),
    // One level of replies, no deep nesting. A reply has a parent; a reply to a
    // reply is rejected in application code, not expressible in the FK alone.
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("comments_insight_idx").on(t.insightId),
    index("comments_parent_idx").on(t.parentId),
  ],
)

/* rejections */

/** Powers the public failure log. An app that shows its rejects. */
export const rejections = pgTable(
  "rejections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rejections_document_idx").on(t.documentId)],
)

﻿
/** Provenance for real election imports. Demo candidates have no source row.
 * FEC registrations are cycle-level records, not confirmed general nominees.
 */
export const candidateSources = pgTable(
  "candidate_sources",
  {
    sourceKey: text("source_key").primaryKey(),
    candidateId: uuid("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
    electionStage: text("election_stage").notNull(),
    candidacyStatus: text("candidacy_status").notNull(),
    sourceName: text("source_name").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceRecord: jsonb("source_record").notNull(),
    incumbentKnown: boolean("incumbent_known").notNull(),
    campaignWebsite: text("campaign_website"),
    biography: text("biography"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("candidate_sources_candidate_idx").on(t.candidateId)],
)

