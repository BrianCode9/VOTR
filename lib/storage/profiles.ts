import { asc, eq } from "drizzle-orm"
import { db, hasDatabase } from "@/db"
import { profileTopics, userProfiles } from "@/db/schema"
import { loadTopics, resolveTopicSlugs, topicIdsForSlugs, type Topic } from "../topics/taxonomy"

/**
 * Reader profiles: the two or three issues someone said they care about.
 *
 * `userId` is whatever identifier the caller presents - today the same
 * anonymous session string reactions and comments use. This module never
 * creates or validates an identity; it stores preferences against one. That is
 * what lets real accounts arrive later as a change to what is written into the
 * column rather than a change to anything that reads it.
 */

/**
 * How many topics a completed profile has.
 *
 * Enforced here and at the API layer, not as a database constraint. "At least
 * two" is a property of a finished onboarding flow, and a check constraint
 * would reject the first row of a two-row insert.
 *
 * The lower bound exists because a single-topic feed is a filter bubble with
 * one wall; the upper bound because past three picks the boost stops
 * distinguishing anything and the ranking degrades to the default feed.
 */
export const MIN_TOPICS = 2
export const MAX_TOPICS = 3

export interface UserProfile {
  id: string
  userId: string
  /** In pick order. */
  selectedTopics: Topic[]
  createdAt: Date
  updatedAt: Date
}

export type ProfileValidation =
  | { ok: true; slugs: string[] }
  | { ok: false; reason: string; unknown?: string[] }

/**
 * Check a set of picks without writing anything.
 *
 * Separated from the write so the API layer can reject a bad request with a
 * useful message before touching the database, and so the count rule has one
 * definition that the route handler and the tests both use.
 */
export async function validateTopicSelection(
  slugs: readonly string[],
): Promise<ProfileValidation> {
  const { known, unknown } = await resolveTopicSlugs(slugs)

  if (unknown.length > 0) {
    return { ok: false, reason: `unknown topics: ${unknown.join(", ")}`, unknown }
  }
  if (known.length < MIN_TOPICS) {
    return { ok: false, reason: `pick at least ${MIN_TOPICS} topics` }
  }
  if (known.length > MAX_TOPICS) {
    return { ok: false, reason: `pick at most ${MAX_TOPICS} topics` }
  }

  return { ok: true, slugs: known }
}

/** The profile row, created on first use. */
async function ensureProfile(userId: string): Promise<string> {
  const [existing] = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1)
  if (existing) return existing.id

  const [created] = await db
    .insert(userProfiles)
    .values({ userId })
    .onConflictDoNothing({ target: userProfiles.userId })
    .returning({ id: userProfiles.id })

  if (created) return created.id

  // Lost a race with a concurrent request for the same session. The row exists
  // now; read it rather than failing a request that asked for something that
  // is in fact true.
  const [found] = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1)
  return found.id
}

/**
 * Replace a reader's picks.
 *
 * A full replace rather than an add/remove pair: the picker is a small fixed
 * set that the reader sees all of at once, so "here is my selection" is the
 * operation they actually perform, and incremental edits would let the stored
 * set drift out of the count bounds between two requests.
 */
export async function setSelectedTopics(
  userId: string,
  slugs: readonly string[],
): Promise<UserProfile> {
  const validated = await validateTopicSelection(slugs)
  if (!validated.ok) throw new Error(validated.reason)

  const profileId = await ensureProfile(userId)
  const idBySlug = await topicIdsForSlugs(validated.slugs)

  await db.delete(profileTopics).where(eq(profileTopics.profileId, profileId))

  const rows = validated.slugs
    .map((slug, rank) => ({ profileId, topicId: idBySlug.get(slug), rank }))
    .filter((r): r is { profileId: string; topicId: string; rank: number } => Boolean(r.topicId))

  if (rows.length > 0) await db.insert(profileTopics).values(rows)

  await db
    .update(userProfiles)
    .set({ updatedAt: new Date() })
    .where(eq(userProfiles.id, profileId))

  const profile = await getProfile(userId)
  if (!profile) throw new Error("profile vanished immediately after being written")
  return profile
}

/** null when this reader has not picked anything yet. */
export async function getProfile(userId: string): Promise<UserProfile | null> {
  if (!hasDatabase) return null

  const [row] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1)
  if (!row) return null

  const picks = await db
    .select({ topicId: profileTopics.topicId })
    .from(profileTopics)
    .where(eq(profileTopics.profileId, row.id))
    .orderBy(asc(profileTopics.rank))

  const byId = new Map((await loadTopics()).map((t) => [t.id, t]))
  const selectedTopics = picks
    .map((p) => byId.get(p.topicId))
    .filter((t): t is Topic => Boolean(t))

  return {
    id: row.id,
    userId: row.userId,
    selectedTopics,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Just the slugs, which is all the feed needs.
 *
 * Returns an empty array for a reader with no profile, and the feed treats
 * that as "no preference" rather than "match nothing". A reader who has not
 * onboarded gets the normal feed, not an empty one.
 */
export async function selectedTopicSlugs(userId: string | null | undefined): Promise<string[]> {
  if (!userId) return []
  const profile = await getProfile(userId)
  return profile?.selectedTopics.map((t) => t.slug) ?? []
}

/** Remove a reader's picks entirely, back to the default feed. */
export async function clearProfile(userId: string): Promise<boolean> {
  const deleted = await db
    .delete(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .returning({ id: userProfiles.id })
  return deleted.length > 0
}
