import { z } from "zod"

/**
 * The single definition of everything the extractor can produce.
 *
 * Per the spec this one schema serves four purposes: the prompt contract (via
 * JSON Schema), runtime validation of what the model returns, the database
 * shape, and the frontend types. Never hand-write a type that duplicates it.
 *
 * Four families come out of one call - stances, stance changes, factual
 * claims, and voter relevance - and every one of them is anchored to a quote.
 * They are flattened into a single discriminated `ExtractedItem` immediately
 * after validation, because everything downstream (verification, persistence,
 * the feed) treats them identically except for a small payload.
 */

/**
 * Fixed issue vocabulary.
 *
 * Deliberately closed rather than free text. The feed filters and the
 * change-detection pass both group by (candidate, issue), and a model left to
 * invent tags produces "healthcare", "health care", and "Healthcare Policy" as
 * three different issues, which silently breaks both.
 */
export const ISSUE_TAGS = [
  "housing",
  "healthcare",
  "education",
  "climate",
  "economy",
  "jobs_and_labor",
  "immigration",
  "public_safety",
  "criminal_justice",
  "reproductive_rights",
  "guns",
  "voting_rights",
  "transit_and_infrastructure",
  "taxes_and_budget",
  "veterans",
  "technology_and_privacy",
  "foreign_policy",
  "other",
] as const

export const issueTagSchema = z.enum(ISSUE_TAGS)
export type IssueTag = z.infer<typeof issueTagSchema>

export const attributionSchema = z.enum(["own_words", "characterization"])
export type Attribution = z.infer<typeof attributionSchema>

export const CARD_TYPES = [
  "stance",
  "stance_change",
  "factual_claim",
  "voter_relevance",
] as const
export const cardTypeSchema = z.enum(CARD_TYPES)
export type CardType = z.infer<typeof cardTypeSchema>

export const checkabilitySchema = z.enum([
  "easily_checkable",
  "requires_expertise",
  "unverifiable",
])
export type Checkability = z.infer<typeof checkabilitySchema>

export const relevanceKindSchema = z.enum(["risk", "opportunity"])
export type RelevanceKind = z.infer<typeof relevanceKindSchema>

/* ------------------------------------------------------- shared fields -- */

const QUOTE_RULE =
  "The exact words from the document, copied character for character. " +
  "Do not paraphrase, do not fix typos, do not change punctuation or quotation marks, " +
  "do not add or remove ellipses. This string is checked against the source and the " +
  "item is discarded if it cannot be located there."

/**
 * The model is asked for offsets, and they are never trusted.
 *
 * A language model cannot count characters in a long document reliably, so
 * these are a hint that verification confirms or overwrites against the real
 * text. They are asked for anyway because a model that has to state a position
 * is measurably more careful about copying the span verbatim, and because a
 * wildly wrong hint is a useful signal that the model was guessing.
 */
const OFFSET_RULE =
  "Your best estimate of the character offset in the document where the quote " +
  "starts or ends. This is checked against the document and corrected, so estimate " +
  "rather than leaving it out."

const quoteFields = {
  quote: z.string().min(1).describe(QUOTE_RULE),
  quoteCharStart: z.number().int().describe(`Start offset. ${OFFSET_RULE}`),
  quoteCharEnd: z.number().int().describe(`End offset. ${OFFSET_RULE}`),
}

const speakerField = z
  .string()
  .describe(
    "The candidate or official this concerns, exactly as written in the document. " +
      "Use an empty string if the document does not attribute it to a named person.",
  )

const plainLanguageField = z
  .string()
  .min(1)
  .describe(
    "One neutral sentence at a low reading level, for a first-time voter. " +
      "No loaded adjectives, no characterization of motive.",
  )

const attributionField = attributionSchema.describe(
  "own_words if the quote is the person speaking or writing. " +
    "characterization if it is a reporter or third party describing them.",
)

const topicField = issueTagSchema.describe(
  "The single best-fitting issue area. This is the primary tag.",
)

/**
 * The reader-facing confidence, asked of every family.
 *
 * Deliberately named for what it measures rather than `confidence`, because
 * this schema now carries two different confidences and the database carries
 * a third:
 *
 *   claimSupportConfidence  - SEMANTIC. Does the quote actually support what
 *                             the card says it supports? This field.
 *   stanceChange.confidence - EVENTIVE. Did a change of position occur, as
 *                             opposed to a rewording? Gates FLIP_FLOP.
 *   quote_similarity        - TEXTUAL. Was the quote copied correctly? Not
 *                             asked of the model at all; measured against the
 *                             document afterwards.
 *
 * A model given one field called "confidence" and three questions answers an
 * average of them, and the average is the one number that means nothing.
 *
 * See lib/confidence/score.ts, which turns this into the stored label, the
 * verify-yourself flag, and the presentation mode.
 */
const claimSupportField = z
  .number()
  .min(0)
  .max(1)
  .describe(
    "How DIRECTLY the quote supports this item, 0 to 1, and nothing else. " +
      "1.0 means the quote states it outright, in these words. " +
      "0.7 means the quote clearly implies it but a reader has to join one step. " +
      "0.4 means it takes real inference, or the quote is about an adjacent " +
      "subject and this is your reading of it. " +
      "Below 0.5 the app will not present the item as something the person " +
      "plainly said; it will show the quote and ask the reader to judge. " +
      "That outcome is correct and useful, so rate honestly rather than high. " +
      "This is NOT about whether the statement is true, whether the position " +
      "is a good one, or whether you copied the quote correctly.",
  )

/**
 * The secondary tags, as free strings rather than an enum.
 *
 * Deliberately not `z.array(issueTagSchema)`. The taxonomy lives in the
 * `topics` table so it can be extended without a deploy, and baking it into
 * the tool schema here would put a second, frozen copy of it in the prompt.
 * Anything the model returns that does not resolve against the table is
 * dropped at persist time; see lib/topics/taxonomy.ts.
 *
 * The vocabulary is named in the user message instead, which is also where it
 * belongs for caching: it varies with the table, the system prompt does not.
 */
const topicsField = z
  .array(z.string())
  .describe(
    "Every issue area this item belongs to, using slugs from the ISSUE TAGS " +
      "list in the user message. Include the primary topic here too. Most items " +
      "have exactly one; add a second only when the item genuinely sits in both, " +
      "such as a rent freeze, which is housing and economy. Never more than three. " +
      "Slugs that are not on the list are discarded, so do not invent one.",
  )

/* --------------------------------------------------------- the four ----- */

export const stanceSchema = z.object({
  topic: topicField,
  topics: topicsField,
  candidateName: speakerField,
  positionSummary: z
    .string()
    .min(1)
    .describe(
      "The position or stance, stated plainly in one sentence. " +
        "It describes what the person thinks, not what the article says.",
    ),
  plainLanguage: plainLanguageField,
  attribution: attributionField,
  /**
   * Replaces the old `confidence` field, which asked this same question under
   * a name three other things also answer to. A stance has exactly one
   * confidence and this is it: `ExtractedItem.confidence` is populated from
   * here, so relevance scoring and the flag rules are unchanged.
   */
  claimSupportConfidence: claimSupportField,
  ...quoteFields,
})

export const stanceChangeSchema = z.object({
  topic: topicField,
  topics: topicsField,
  candidateName: speakerField,
  previousPosition: z
    .string()
    .min(1)
    .describe(
      "The earlier position, taken from the PRIOR STANCES given to you. " +
        "Never from your own knowledge and never inferred from this document alone.",
    ),
  currentPosition: z
    .string()
    .min(1)
    .describe("The position this document supports, which differs from the previous one."),
  plainLanguage: plainLanguageField,
  attribution: attributionField,
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "How confident you are that this is a real change rather than a difference " +
        "in wording, emphasis, or the question being answered, 0 to 1. " +
        "This is about WHETHER THE CHANGE HAPPENED. It is a different question " +
        "from claimSupportConfidence, which is about whether the quote supports " +
        "the current position. Answer both separately.",
    ),
  claimSupportConfidence: claimSupportField,
  priorInsightId: z
    .string()
    .describe(
      "The id of the prior stance being compared against, copied from the PRIOR " +
        "STANCES block. Empty string only if no single prior record is the source.",
    ),
  quote: z.string().min(1).describe(`Evidence for the CURRENT position. ${QUOTE_RULE}`),
  quoteCharStart: z.number().int().describe(`Start offset. ${OFFSET_RULE}`),
  quoteCharEnd: z.number().int().describe(`End offset. ${OFFSET_RULE}`),
})

export const factualClaimSchema = z.object({
  topic: topicField,
  topics: topicsField,
  candidateName: speakerField,
  claimText: z
    .string()
    .min(1)
    .describe("The factual assertion, stated as one checkable sentence."),
  plainLanguage: plainLanguageField,
  attribution: attributionField,
  checkability: checkabilitySchema.describe(
    "easily_checkable: a named source could settle it in minutes, such as a public " +
      "statistic or a vote record. " +
      "requires_expertise: settling it needs domain analysis or modelling. " +
      "unverifiable: a prediction, a statement about intent, or a value judgment.",
  ),
  claimSupportConfidence: claimSupportField,
  ...quoteFields,
})

export const voterRelevanceSchema = z.object({
  topic: topicField,
  topics: topicsField,
  candidateName: speakerField,
  type: relevanceKindSchema.describe(
    "risk if the quoted position or fact could make someone worse off. " +
      "opportunity if it could make them better off.",
  ),
  description: z
    .string()
    .min(1)
    .describe(
      "What concretely changes for that group, in one sentence. " +
        "Describe the stated policy's effect, do not predict motives or outcomes " +
        "the document does not support.",
    ),
  affectedGroup: z
    .string()
    .min(1)
    .describe(
      "Who is affected, as specifically as the document supports, such as " +
        "renters in the city, or veterans using VA clinics. Never everyone.",
    ),
  plainLanguage: plainLanguageField,
  attribution: attributionField,
  claimSupportConfidence: claimSupportField,
  ...quoteFields,
})

/** The tool payload: one document yields zero or more of each family. */
export const extractionResultSchema = z.object({
  stances: z
    .array(stanceSchema)
    .describe(
      "Every position this document supports with a direct quote. " +
        "Empty array if the document contains no quotable position.",
    ),
  stanceChanges: z
    .array(stanceChangeSchema)
    .describe(
      "Only where a PRIOR STANCES record contradicts or shifts from what this " +
        "document says. Always an empty array if no prior stances were given to you.",
    ),
  factualClaims: z
    .array(factualClaimSchema)
    .describe("Checkable factual assertions made in the document. Empty array if none."),
  voterRelevance: z
    .array(voterRelevanceSchema)
    .describe(
      "Concrete risks or opportunities for an identifiable group of voters. " +
        "Empty array if the document does not support any.",
    ),
})

export type ExtractionResult = z.infer<typeof extractionResultSchema>
export type Stance = z.infer<typeof stanceSchema>
export type StanceChange = z.infer<typeof stanceChangeSchema>
export type FactualClaim = z.infer<typeof factualClaimSchema>
export type VoterRelevance = z.infer<typeof voterRelevanceSchema>

/* ------------------------------------------------------ flattened form -- */

/** Card-type specific fields. Stored as jsonb, never queried for filtering. */
export type InsightPayload =
  | { cardType: "stance" }
  | { cardType: "stance_change"; previousPosition: string; priorInsightId: string | null }
  | { cardType: "factual_claim"; checkability: Checkability }
  | { cardType: "voter_relevance"; relevanceKind: RelevanceKind; affectedGroup: string }

/**
 * One extracted item of any family, before verification.
 *
 * `quote` is the only field the model is asked to reproduce verbatim and the
 * only one that is not trusted. It never reaches the database as a string:
 * verification converts it to offsets or the item is discarded.
 */
export interface ExtractedItem {
  cardType: CardType
  /** The primary tag, from the closed enum. Stored in insights.issue_tag. */
  topic: IssueTag
  /**
   * Every tag the model proposed, primary first, NOT yet validated.
   *
   * These are raw strings on purpose: the taxonomy is a table, so the only
   * place that can say whether a slug is real is a query. Persistence resolves
   * them and drops what does not exist. Nothing should read this field
   * expecting the values to be known-good.
   */
  topics: string[]
  /** null when the document names no speaker. */
  candidateName: string | null
  /** The card's headline claim: the stance, the new position, the claim, the risk. */
  headline: string
  plainLanguage: string
  attribution: Attribution
  /**
   * The family's own confidence, whatever it means for that family.
   *
   * stance: the quote-to-position link (same value as claimSupportConfidence).
   * stance_change: whether the change of position is real, which is what the
   * FLIP_FLOP threshold reads. factual_claim and voter_relevance: 1, because
   * those families are not asked an eventive question and `relevanceScore`
   * multiplies by this.
   *
   * Left exactly as it was so flag assignment and ranking are unchanged. New
   * code that wants "how well does the quote back this up" wants
   * `claimSupportConfidence` instead.
   */
  confidence: number
  /**
   * How directly the quote supports the card's claim, 0 to 1. Present on all
   * four families. This is the one a reader sees, via the label and the
   * presentation mode. See lib/confidence/score.ts.
   */
  claimSupportConfidence: number
  quote: string
  /** The model's own guess at the offsets, kept only to compare against truth. */
  quoteHint: { start: number; end: number }
  payload: InsightPayload
}

/**
 * The model's tags, primary first, de-duplicated.
 *
 * The enum `topic` is always included even if the model left it out of its own
 * list, because it is the one tag the schema guaranteed and the one the
 * issue_tag column will hold. Capped, so a model that decides everything is
 * about ten issues cannot write ten join rows per card.
 */
const MAX_TOPICS_PER_ITEM = 3

function topicList(primary: IssueTag, proposed: string[]): string[] {
  const out: string[] = [primary]
  for (const raw of proposed) {
    const slug = raw.trim().toLowerCase()
    if (!slug || out.includes(slug)) continue
    out.push(slug)
    if (out.length >= MAX_TOPICS_PER_ITEM) break
  }
  return out
}

function speaker(name: string): string | null {
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Collapse the four families into one list.
 *
 * Everything after this point - verification, dedup, persistence, the feed -
 * handles a single shape. Adding a fifth family means adding a schema, a case
 * here, and nothing else.
 */
export function flattenExtraction(result: ExtractionResult): ExtractedItem[] {
  const items: ExtractedItem[] = []

  for (const s of result.stances) {
    items.push({
      cardType: "stance",
      topic: s.topic,
      topics: topicList(s.topic, s.topics),
      candidateName: speaker(s.candidateName),
      headline: s.positionSummary,
      plainLanguage: s.plainLanguage,
      attribution: s.attribution,
      confidence: s.claimSupportConfidence,
      claimSupportConfidence: s.claimSupportConfidence,
      quote: s.quote,
      quoteHint: { start: s.quoteCharStart, end: s.quoteCharEnd },
      payload: { cardType: "stance" },
    })
  }

  for (const c of result.stanceChanges) {
    items.push({
      cardType: "stance_change",
      topic: c.topic,
      topics: topicList(c.topic, c.topics),
      candidateName: speaker(c.candidateName),
      headline: c.currentPosition,
      plainLanguage: c.plainLanguage,
      attribution: c.attribution,
      confidence: c.confidence,
      claimSupportConfidence: c.claimSupportConfidence,
      quote: c.quote,
      quoteHint: { start: c.quoteCharStart, end: c.quoteCharEnd },
      payload: {
        cardType: "stance_change",
        previousPosition: c.previousPosition,
        priorInsightId: speaker(c.priorInsightId),
      },
    })
  }

  for (const f of result.factualClaims) {
    items.push({
      cardType: "factual_claim",
      topic: f.topic,
      topics: topicList(f.topic, f.topics),
      candidateName: speaker(f.candidateName),
      headline: f.claimText,
      plainLanguage: f.plainLanguage,
      attribution: f.attribution,
      // Left at 1 so `relevanceScore` and the flag rules behave exactly as
      // they did: for this family `confidence` was never a rating, and turning
      // it into one now would silently re-rank every stored claim. The real
      // rating lives in claimSupportConfidence, which the card reads.
      confidence: 1,
      claimSupportConfidence: f.claimSupportConfidence,
      quote: f.quote,
      quoteHint: { start: f.quoteCharStart, end: f.quoteCharEnd },
      payload: { cardType: "factual_claim", checkability: f.checkability },
    })
  }

  for (const v of result.voterRelevance) {
    items.push({
      cardType: "voter_relevance",
      topic: v.topic,
      topics: topicList(v.topic, v.topics),
      candidateName: speaker(v.candidateName),
      headline: v.description,
      plainLanguage: v.plainLanguage,
      attribution: v.attribution,
      confidence: 1,
      claimSupportConfidence: v.claimSupportConfidence,
      quote: v.quote,
      quoteHint: { start: v.quoteCharStart, end: v.quoteCharEnd },
      payload: {
        cardType: "voter_relevance",
        relevanceKind: v.type,
        affectedGroup: v.affectedGroup,
      },
    })
  }

  return items
}

/**
 * An item that passed verification and therefore has real offsets.
 *
 * The quote string is intentionally NOT carried into the database. It lives
 * here only so callers can log what the model claimed versus what matched.
 */
export interface VerifiedItem extends ExtractedItem {
  quoteCharStart: number
  quoteCharEnd: number
  /** Which rung of the ladder matched. Never "failed": those are discarded. */
  quoteVerified: "exact" | "normalized" | "transcript" | "fuzzy"
  /** 1 on the exact rung, the measured ratio on the fuzzy rung. */
  similarity: number
  /** >1 means the quote appears more than once and the span is ambiguous. */
  occurrences: number
  /** How far the model's offset guess was from the truth, in characters. */
  hintDrift: number
}

/** A prior stance handed to the model so it can detect a real change. */
export interface PriorStance {
  id: string
  topic: IssueTag
  candidateName: string
  positionSummary: string
  quote: string
  sourceName: string
  publishedAt: Date | null
}
