import { z } from "zod"

/**
 * The "what changed" vocabulary.
 *
 * Defined once here and imported everywhere. The database has the same values
 * as a pgEnum, which is what makes them safe to filter on, but no call site
 * should ever write the literal `"FLIP_FLOP"`: adding a fourth badge should be
 * a change to this file, a migration, and nothing else.
 *
 * Extending it takes three steps, in this order:
 *   1. add the value here,
 *   2. `ALTER TYPE insight_flag ADD VALUE '<new>'` in a migration,
 *   3. add its rule to assignFlags in ./assign.ts.
 * Steps 1 and 2 without 3 give you a flag nothing ever assigns, which is
 * harmless. Step 3 without 2 fails at insert time, which is why the migration
 * comes first.
 */
export const INSIGHT_FLAGS = ["NEW", "FLIP_FLOP", "UNVERIFIED_CLAIM"] as const

export const insightFlagSchema = z.enum(INSIGHT_FLAGS)
export type InsightFlag = z.infer<typeof insightFlagSchema>

export function isInsightFlag(value: string): value is InsightFlag {
  return (INSIGHT_FLAGS as readonly string[]).includes(value)
}

/**
 * Where a factual claim stands against an outside source.
 *
 * `unresolved` is the starting state and, until a FactCheckProvider is wired
 * up, the only one. That is deliberate: a claim nobody has checked is not the
 * same as a claim that checked out, and collapsing the two is exactly the
 * error this app exists to avoid.
 */
export const FACT_CHECK_STATUSES = [
  "unresolved",
  "supported",
  "disputed",
  "false",
] as const

export const factCheckStatusSchema = z.enum(FACT_CHECK_STATUSES)
export type FactCheckStatus = z.infer<typeof factCheckStatusSchema>

/** Anything but `unresolved` means something actually looked at the claim. */
export function isResolved(status: FactCheckStatus): boolean {
  return status !== "unresolved"
}
