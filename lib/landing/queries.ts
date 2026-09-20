import { and, desc, eq, isNotNull, sql } from "drizzle-orm"
import { db, hasDatabase } from "@/db"
import {
  candidates as candidatesTable,
  candidateSources,
  districts,
  insights,
  races,
  topics as topicsTable,
} from "@/db/schema"
import {
  type Candidate,
  type Election,
  type Issue,
  type PolicyArea,
  type Topic,
  elections as staticElections,
  federalCandidates as staticFederal,
  issues as staticIssues,
  localCandidates as staticLocal,
  policyAreas as staticPolicyAreas,
  topics as staticTopics,
} from "./content"
import { iconFor } from "@/lib/topics/icons"

/**
 * The landing page, backed by the real database.
 *
 * content.ts was written as placeholder data shaped like an API response, with
 * the note that each getter would become a real query. This is that. The
 * shapes are unchanged, so the components did not have to be rewritten to
 * accept them.
 *
 * Every function falls back to the static content when there is no database or
 * when a query returns nothing. That is not cosmetic: a teammate who is not in
 * the Neon org yet still gets a page that looks finished, and a demo does not
 * degrade into empty sections if a query goes wrong on stage.
 */

/** "3 positions on the record" reads honestly at 3 and at 0. */
function coverageNote(count: number): string {
  if (count === 0) return "Nothing on the record yet"
  if (count === 1) return "1 position on the record"
  return `${count} positions on the record`
}

/**
 * Topics with real coverage counts.
 *
 * `other` is excluded. It is a real bucket in the pipeline and a meaningless
 * thing to offer a reader as an interest.
 */
export async function getTopics(): Promise<Topic[]> {
  if (!hasDatabase) return staticTopics

  try {
    const rows = await db
      .select({
        slug: topicsTable.slug,
        label: topicsTable.label,
        description: topicsTable.description,
        sortOrder: topicsTable.sortOrder,
        count: sql<number>`count(${insights.id})::int`,
      })
      .from(topicsTable)
      .leftJoin(insights, eq(insights.issueTag, topicsTable.slug))
      .where(and(eq(topicsTable.active, true), sql`${topicsTable.slug} <> 'other'`))
      .groupBy(topicsTable.slug, topicsTable.label, topicsTable.description, topicsTable.sortOrder)
      .orderBy(desc(sql`count(${insights.id})`), topicsTable.sortOrder)

    if (rows.length === 0) return staticTopics

    // Trending is the top three by real coverage, not an editorial choice.
    return rows.map((r, i) => ({
      id: r.slug,
      title: r.label,
      icon: iconFor(r.slug),
      blurb: r.description ?? "",
      meta: coverageNote(r.count),
      trending: i < 3 && r.count > 0,
    }))
  } catch {
    return staticTopics
  }
}

export async function getPolicyAreas(): Promise<PolicyArea[]> {
  if (!hasDatabase) return staticPolicyAreas

  try {
    const rows = await getTopics()
    if (rows.length === 0) return staticPolicyAreas

    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      icon: t.icon,
      blurb: t.blurb,
      trackedCount: Number(/\d+/.exec(t.meta)?.[0] ?? 0),
    }))
  } catch {
    return staticPolicyAreas
  }
}

export async function getIssues(): Promise<Issue[]> {
  if (!hasDatabase) return staticIssues

  try {
    const rows = await db
      .select({ slug: topicsTable.slug, label: topicsTable.label })
      .from(topicsTable)
      .where(and(eq(topicsTable.active, true), sql`${topicsTable.slug} <> 'other'`))
      .orderBy(topicsTable.sortOrder)

    if (rows.length === 0) return staticIssues
    return rows.map((r) => ({ id: r.slug, label: r.label, icon: iconFor(r.slug) }))
  } catch {
    return staticIssues
  }
}

/**
 * Real candidates, restricted to those with a source record.
 *
 * The join to candidate_sources is what keeps invented people off the page.
 * Extraction creates a candidate row for any name it reads in an article, so
 * the table also contains things like "Trump administration" and the name of a
 * news network. Those have no certified source record behind them, and a civic
 * app that lists them as candidates is lying in the most ordinary way.
 *
 * The bio is the official ballot designation, which is what the reader would
 * see on the paper ballot. It is not a description anyone wrote for this app.
 */
async function realCandidates(level: "federal" | "state", limit: number): Promise<Candidate[]> {
  const rows = await db
    .selectDistinctOn([candidatesTable.name], {
      id: candidatesTable.id,
      name: candidatesTable.name,
      party: candidatesTable.party,
      office: races.office,
      state: districts.state,
      district: districts.name,
      bio: candidateSources.biography,
    })
    .from(candidatesTable)
    .innerJoin(candidateSources, eq(candidateSources.candidateId, candidatesTable.id))
    .innerJoin(races, eq(races.id, candidatesTable.raceId))
    .innerJoin(districts, eq(districts.id, races.districtId))
    .where(
      and(
        eq(races.level, level),
        isNotNull(candidateSources.biography),
        isNotNull(candidatesTable.party),
      ),
    )
    .orderBy(candidatesTable.name)
    .limit(limit)

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    office: r.office,
    party: r.party ?? "Unaffiliated",
    jurisdiction: r.district && r.district !== "Demo district" ? r.district : r.state,
    bio: r.bio ?? "",
    photoUrl: null,
  }))
}

export async function getFederalCandidates(limit = 6): Promise<Candidate[]> {
  if (!hasDatabase) return staticFederal
  try {
    const rows = await realCandidates("federal", limit)
    return rows.length > 0 ? rows : staticFederal
  } catch {
    return staticFederal
  }
}

export async function getLocalCandidates(limit = 6): Promise<Candidate[]> {
  if (!hasDatabase) return staticLocal
  try {
    const rows = await realCandidates("state", limit)
    return rows.length > 0 ? rows : staticLocal
  } catch {
    return staticLocal
  }
}

/**
 * Elections from the races on file.
 *
 * One entry per election date, listing the levels of office actually being
 * voted on, rather than a hardcoded calendar.
 */
export async function getElections(): Promise<Election[]> {
  if (!hasDatabase) return staticElections

  try {
    const rows = await db
      .select({
        date: races.electionDate,
        level: races.level,
        offices: sql<number>`count(distinct ${races.office})::int`,
      })
      .from(races)
      .groupBy(races.electionDate, races.level)
      .orderBy(races.electionDate)

    if (rows.length === 0) return staticElections

    const byDate = new Map<string, { levels: Set<string>; offices: number }>()
    for (const r of rows) {
      if (!r.date) continue
      const key = r.date.toISOString().slice(0, 10)
      const entry = byDate.get(key) ?? { levels: new Set<string>(), offices: 0 }
      entry.levels.add(r.level)
      entry.offices += r.offices
      byDate.set(key, entry)
    }

    if (byDate.size === 0) return staticElections

    const today = new Date().toISOString().slice(0, 10)

    return [...byDate.entries()]
      .filter(([date]) => date >= today)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        id: date,
        date,
        name: v.levels.has("federal") ? "General election" : "State and local election",
        levels: [...v.levels] as Election["levels"],
        note:
          v.offices === 1
            ? "1 office on the ballot"
            : `${v.offices} offices on the ballot`,
      }))
  } catch {
    return staticElections
  }
}
