import { and, eq, sql } from "drizzle-orm"
import { db, hasDatabase } from "@/db"
import { insights, savedInsights } from "@/db/schema"
import { getInsightFeed, type FeedPage } from "../queries/feed"

/**
 * Swipe-to-save.
 *
 * Idempotency is a property of the unique index on (user_id, insight_id), not
 * of any check performed here. That matters because the duplicate this guards
 * against is not a user tapping twice on purpose - it is a double-tap, a
 * retried request after a dropped connection, and two tabs, all of which race
 * each other. A read-then-write check would let every one of those through.
 *
 * Reading a saved list goes through getInsightFeed with `savedBy` set, so
 * saved cards get the same quote slicing, same-quote collapsing and cursor
 * pagination as the main feed rather than a second, drifting implementation.
 */

export interface SaveResult {
  saved: boolean
  /** True when the row already existed. The request still succeeded. */
  alreadySaved: boolean
  savedAt: Date | null
}

/**
 * Save an insight. Safe to call any number of times.
 *
 * The insight's existence is checked first so that saving a deleted or
 * mistyped id is a clean "not found" rather than a foreign-key error surfacing
 * as a 500.
 */
export async function saveInsight(
  userId: string,
  insightId: string,
): Promise<SaveResult | null> {
  const [exists] = await db
    .select({ id: insights.id })
    .from(insights)
    .where(eq(insights.id, insightId))
    .limit(1)
  if (!exists) return null

  const [inserted] = await db
    .insert(savedInsights)
    .values({ userId, insightId })
    // The idempotency guard. A repeat save is a no-op, and savedAt keeps its
    // original value so the list stays in the order things were first saved.
    .onConflictDoNothing({ target: [savedInsights.userId, savedInsights.insightId] })
    .returning({ savedAt: savedInsights.savedAt })

  if (inserted) return { saved: true, alreadySaved: false, savedAt: inserted.savedAt }

  const [existing] = await db
    .select({ savedAt: savedInsights.savedAt })
    .from(savedInsights)
    .where(and(eq(savedInsights.userId, userId), eq(savedInsights.insightId, insightId)))
    .limit(1)

  return { saved: true, alreadySaved: true, savedAt: existing?.savedAt ?? null }
}

/** Remove a save. Returns false when there was nothing to remove. */
export async function unsaveInsight(userId: string, insightId: string): Promise<boolean> {
  const deleted = await db
    .delete(savedInsights)
    .where(and(eq(savedInsights.userId, userId), eq(savedInsights.insightId, insightId)))
    .returning({ id: savedInsights.id })

  return deleted.length > 0
}

export async function isSaved(userId: string, insightId: string): Promise<boolean> {
  if (!hasDatabase) return false
  const [row] = await db
    .select({ id: savedInsights.id })
    .from(savedInsights)
    .where(and(eq(savedInsights.userId, userId), eq(savedInsights.insightId, insightId)))
    .limit(1)
  return Boolean(row)
}

/**
 * One reader's saved cards, newest save first.
 *
 * Ordered by when they saved it rather than when it was published: a saved
 * list is a record of what someone did, and sorting it by article date would
 * shuffle yesterday's save below a backfilled older document.
 */
export async function listSavedInsights(
  userId: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<FeedPage> {
  return getInsightFeed({
    savedBy: userId,
    sort: "saved",
    limit: options.limit,
    cursor: options.cursor,
  })
}

/** How many cards this reader has saved. For a header count. */
export async function countSavedInsights(userId: string): Promise<number> {
  if (!hasDatabase) return 0
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(savedInsights)
    .where(eq(savedInsights.userId, userId))
  return row?.n ?? 0
}

/**
 * Which of these insight ids the reader has saved.
 *
 * For rendering a feed page with the save state already filled in, without a
 * request per card.
 */
export async function savedIdsAmong(
  userId: string,
  insightIds: readonly string[],
): Promise<Set<string>> {
  if (!hasDatabase || insightIds.length === 0) return new Set()

  const list = sql.join(
    insightIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )

  const rows = await db
    .select({ insightId: savedInsights.insightId })
    .from(savedInsights)
    .where(and(eq(savedInsights.userId, userId), sql`${savedInsights.insightId} in (${list})`))

  return new Set(rows.map((r) => r.insightId))
}
