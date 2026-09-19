import { z } from "zod"

/**
 * The single definition of an extracted insight.
 *
 * Per CLAUDE.md this one schema serves four purposes: the prompt contract (via
 * JSON Schema), runtime validation of what the model returns, the database
 * shape, and the frontend types. Never hand-write a type that duplicates it.
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

/**
 * One insight as the extractor returns it, before verification.
 *
 * `quote` is the only field the model is asked to reproduce verbatim, and it is
 * the only field that is not trusted. It never reaches the database as a
 * string: verification converts it to offsets or the insight is discarded.
 */
export const extractedInsightSchema = z.object({
  candidateName: z
    .string()
    .min(1)
    .describe(
      "The candidate or official whose position this is, exactly as written in the document.",
    ),
  issueTag: issueTagSchema.describe("Which issue area this position belongs to."),
  positionText: z
    .string()
    .min(1)
    .describe(
      "The position or stance, stated plainly in one sentence. Not a summary of the article.",
    ),
  quote: z
    .string()
    .min(1)
    .describe(
      "The exact words from the document that support this position, copied character for character. " +
        "Do not paraphrase, do not fix typos, do not change punctuation or quotation marks, " +
        "do not add or remove ellipses. This string is checked against the source and the insight " +
        "is discarded if it does not appear there verbatim.",
    ),
  plainLanguage: z
    .string()
    .min(1)
    .describe(
      "One neutral sentence at a low reading level restating the position for a first-time voter. " +
        "No loaded adjectives, no characterization of motive.",
    ),
  attribution: attributionSchema.describe(
    "own_words if the quote is the candidate speaking or writing. " +
      "characterization if it is a reporter or third party describing their position.",
  ),
  checkableClaims: z
    .array(z.string())
    .describe(
      "Specific factual claims made in the quote that could be independently checked. Empty array if none.",
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "How directly the quote supports the stated position, 0 to 1. " +
        "Low when the connection requires inference. This is about the quote-to-position link only.",
    ),
})

export type ExtractedInsight = z.infer<typeof extractedInsightSchema>

/** The tool payload: a document yields zero or more insights. */
export const extractionResultSchema = z.object({
  insights: z
    .array(extractedInsightSchema)
    .describe(
      "Every position this document supports with a direct quote. " +
        "Return an empty array if the document contains no quotable positions from a candidate.",
    ),
})

export type ExtractionResult = z.infer<typeof extractionResultSchema>

/**
 * An insight that passed verification and therefore has real offsets.
 *
 * The quote string is intentionally NOT carried forward into the database. It
 * lives here only so callers can log what matched.
 */
export interface VerifiedInsight extends ExtractedInsight {
  quoteCharStart: number
  quoteCharEnd: number
  /** Which rung of the ladder matched. Signal for the judge stage. */
  rung: "exact" | "normalized" | "transcript"
  /** >1 means the quote appears more than once and the span is ambiguous. */
  occurrences: number
}
