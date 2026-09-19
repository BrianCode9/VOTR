import { asc, inArray, sql } from "drizzle-orm"
import { db, hasDatabase } from "@/db"
import { topics } from "@/db/schema"

/**
 * The issue taxonomy.
 *
 * The list below is a SEED, not the source of truth. The source of truth is
 * the `topics` table, and every read path in the app resolves slugs against
 * that table rather than against this array. The distinction matters: a topic
 * added to the table by hand, by a later seed run, or by an admin screen works
 * immediately everywhere, including in the extractor's validation, without a
 * deploy.
 *
 * What this array is for is bootstrapping an empty database and giving the
 * prompt a stable vocabulary to name. Re-running the seed is an upsert on
 * `slug`, so it never duplicates and never clobbers a label someone edited.
 *
 * The slugs match the spellings already stored in insights.issue_tag. Keep it
 * that way: the personal feed joins this table against that column, and a
 * rename here without a data migration silently makes a topic match nothing.
 */

export interface TopicSeed {
  slug: string
  label: string
  description: string
  sortOrder: number
}

export const TOPIC_SEED: readonly TopicSeed[] = [
  {
    slug: "housing",
    label: "Housing",
    description: "Rent, home prices, zoning, and homelessness.",
    sortOrder: 10,
  },
  {
    slug: "healthcare",
    label: "Healthcare",
    description: "Coverage, costs, hospitals, and prescription drugs.",
    sortOrder: 20,
  },
  {
    slug: "education",
    label: "Education",
    description: "Schools, teachers, and what happens in classrooms.",
    sortOrder: 30,
  },
  {
    slug: "student_debt",
    label: "Student debt",
    description: "Loans, repayment, forgiveness, and college costs.",
    sortOrder: 35,
  },
  {
    slug: "climate",
    label: "Climate",
    description: "Emissions, energy, and preparing for extreme weather.",
    sortOrder: 40,
  },
  {
    slug: "economy",
    label: "Economy",
    description: "Prices, wages, and the cost of everyday things.",
    sortOrder: 50,
  },
  {
    slug: "jobs_and_labor",
    label: "Jobs and work",
    description: "Hiring, unions, wages, and working conditions.",
    sortOrder: 60,
  },
  {
    slug: "immigration",
    label: "Immigration",
    description: "Borders, visas, asylum, and enforcement.",
    sortOrder: 70,
  },
  {
    slug: "public_safety",
    label: "Public safety",
    description: "Policing, emergency services, and neighborhood safety.",
    sortOrder: 80,
  },
  {
    slug: "criminal_justice",
    label: "Criminal justice",
    description: "Courts, sentencing, prisons, and reentry.",
    sortOrder: 90,
  },
  {
    slug: "reproductive_rights",
    label: "Abortion and reproductive rights",
    description: "Abortion access, contraception, and fertility care.",
    sortOrder: 100,
  },
  {
    slug: "guns",
    label: "Gun policy",
    description: "Firearm ownership, background checks, and restrictions.",
    sortOrder: 110,
  },
  {
    slug: "voting_rights",
    label: "Voting and elections",
    description: "Registration, ballot access, and how elections are run.",
    sortOrder: 120,
  },
  {
    slug: "transit_and_infrastructure",
    label: "Transit and infrastructure",
    description: "Roads, transit, water, and broadband.",
    sortOrder: 130,
  },
  {
    slug: "taxes_and_budget",
    label: "Taxes and spending",
    description: "What is taxed, who pays, and where the money goes.",
    sortOrder: 140,
  },
  {
    slug: "veterans",
    label: "Veterans",
    description: "Benefits, VA care, and service members returning home.",
    sortOrder: 150,
  },
  {
    slug: "technology_and_privacy",
    label: "Technology and privacy",
    description: "Data, surveillance, AI, and online platforms.",
    sortOrder: 160,
  },
  {
    slug: "foreign_policy",
    label: "Foreign policy",
    description: "Wars, alliances, trade, and aid abroad.",
    sortOrder: 170,
  },
  {
    slug: "other",
    label: "Other",
    description: "Issues that do not fit the list above.",
    sortOrder: 900,
  },
] as const

export interface Topic {
  id: string
  slug: string
  label: string
  description: string
  sortOrder: number
  active: boolean
}

/* drizzle has no `excluded.<col>` helper, so the upsert spells it out. */
function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`)
}

/**
 * Seed or refresh the taxonomy table.
 *
 * Idempotent, and safe to run against a populated database: it upserts on
 * `slug` and only writes the fields the seed owns. A topic in the table that
 * is not in the seed is left alone rather than deactivated, because it may
 * have been added deliberately and insights may already point at it.
 */
export async function seedTopics(): Promise<{ upserted: number }> {
  await db
    .insert(topics)
    .values(TOPIC_SEED.map((t) => ({ ...t, active: true })))
    .onConflictDoUpdate({
      target: topics.slug,
      set: {
        label: sqlExcluded("label"),
        description: sqlExcluded("description"),
        sortOrder: sqlExcluded("sort_order"),
      },
    })

  return { upserted: TOPIC_SEED.length }
}

/* ------------------------------------------------------------- caching -- */

/**
 * The taxonomy is read on every extraction and every personal feed request and
 * changes roughly never, so it is cached in process. The TTL exists so that a
 * row added by hand shows up without a restart; it is not a correctness
 * mechanism, and `invalidateTopicCache` is the one that is.
 */
const CACHE_TTL_MS = 60_000

let cache: { at: number; topics: Topic[] } | null = null

export function invalidateTopicCache(): void {
  cache = null
}

export async function loadTopics(options: { force?: boolean } = {}): Promise<Topic[]> {
  if (!options.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.topics
  }

  // Without a database the seed is the best available answer. Ids are the one
  // thing it cannot supply, so they are empty strings: callers that need an id
  // are doing a write, and a write without a database fails anyway.
  if (!hasDatabase) {
    return TOPIC_SEED.map((t) => ({ ...t, id: "", active: true }))
  }

  const rows = await db
    .select()
    .from(topics)
    .orderBy(asc(topics.sortOrder), asc(topics.label))

  cache = { at: Date.now(), topics: rows }
  return rows
}

/** Slug to row, for the active topics only. */
export async function activeTopics(): Promise<Topic[]> {
  return (await loadTopics()).filter((t) => t.active)
}

/**
 * The vocabulary handed to the extractor.
 *
 * Active topics only: a retired topic still resolves for rows that already
 * carry it, but the model should stop producing new ones.
 */
export async function topicVocabulary(): Promise<string[]> {
  return (await activeTopics()).map((t) => t.slug)
}

/**
 * Keep only the slugs that exist in the taxonomy.
 *
 * This is the validation boundary for model output. Anything the extractor
 * invents is dropped here rather than stored, because a tag that matches no
 * taxonomy row is a tag no reader can ever have selected, so an insight
 * carrying it is invisible to the personal feed for no stated reason.
 *
 * Case and surrounding whitespace are forgiven; anything else is not.
 */
export async function resolveTopicSlugs(
  slugs: readonly string[],
): Promise<{ known: string[]; unknown: string[] }> {
  const all = await loadTopics()
  const bySlug = new Map(all.map((t) => [t.slug.toLowerCase(), t.slug]))

  const known: string[] = []
  const unknown: string[] = []
  const seen = new Set<string>()

  for (const raw of slugs) {
    const canonical = bySlug.get(raw.trim().toLowerCase())
    if (!canonical) {
      if (raw.trim()) unknown.push(raw.trim())
      continue
    }
    if (seen.has(canonical)) continue
    seen.add(canonical)
    known.push(canonical)
  }

  return { known, unknown }
}

/** Slug to topic id, for writing join rows. Unknown slugs are absent. */
export async function topicIdsForSlugs(
  slugs: readonly string[],
): Promise<Map<string, string>> {
  const all = await loadTopics()
  const bySlug = new Map(all.map((t) => [t.slug.toLowerCase(), t]))

  const out = new Map<string, string>()
  for (const slug of slugs) {
    const topic = bySlug.get(slug.trim().toLowerCase())
    if (topic?.id) out.set(topic.slug, topic.id)
  }
  return out
}

/** Topic ids to slugs, for turning a stored profile back into filter terms. */
export async function slugsForTopicIds(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const all = await loadTopics()
  const byId = new Map(all.map((t) => [t.id, t.slug]))

  const missing = ids.filter((id) => !byId.has(id))
  // A brand new topic can be picked in the same request that created it, which
  // the cache has not seen yet. One narrow lookup beats invalidating globally.
  if (missing.length > 0 && hasDatabase) {
    const rows = await db.select().from(topics).where(inArray(topics.id, missing))
    for (const row of rows) byId.set(row.id, row.slug)
  }

  return ids.map((id) => byId.get(id)).filter((s): s is string => Boolean(s))
}
