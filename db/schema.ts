import {
  pgTable,
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
export const insightFlag = pgEnum("insight_flag", ["NEW", "FLIP_FLOP", "UNVERIFIED_CLAIM"])
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
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    issueTag: text("issue_tag").notNull(),
    positionText: text("position_text").notNull(),
    plainLanguage: text("plain_language").notNull(),
    quoteCharStart: integer("quote_char_start").notNull(),
    quoteCharEnd: integer("quote_char_end").notNull(),
    timestampStart: real("timestamp_start"), // transcripts only, seconds
    timestampEnd: real("timestamp_end"),
    attribution: attribution("attribution").notNull(),
    flag: insightFlag("flag"),
    extractorConfidence: real("extractor_confidence"),
    judgeRating: integer("judge_rating"), // Nemotron, 0 to 3
    status: insightStatus("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("insights_candidate_issue_idx").on(t.candidateId, t.issueTag),
    index("insights_document_idx").on(t.documentId),
    index("insights_status_idx").on(t.status),
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
