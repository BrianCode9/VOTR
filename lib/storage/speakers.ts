import { eq, inArray, sql } from "drizzle-orm"
import { db, hasDatabase } from "@/db"
import { candidates, speakers } from "@/db/schema"
import {
  aliasSet,
  namesMatch,
  normalizeSpeakerName,
  preferredDisplayName,
} from "../speakers/normalize"

/**
 * Speaker resolution.
 *
 * One person, many spellings, many ballot lines. The matching rules are in
 * lib/speakers/normalize.ts and are pure; this module is the part that talks
 * to the table, and it does exactly two things: find the person a name refers
 * to, and remember the spelling so the next lookup is an index hit.
 *
 * Why this exists at all, given `candidates`: a candidate row is scoped to a
 * race, so the same person in two races is two rows, and two outlets spelling
 * a name two ways is two more. Grouping stance history by candidate therefore
 * shows a fraction of a person's record and presents it as the whole. The
 * timeline and the NEW / FLIP_FLOP rules both group on a speaker instead.
 */

export interface Speaker {
  id: string
  name: string
  normalizedName: string
  normalizedAliases: string[]
  party: string | null
  role: string | null
}

/**
 * Find or create the speaker a name refers to.
 *
 * Three steps, cheapest first:
 *
 *   1. Exact normalized name. One unique-index probe, and the common case.
 *   2. Alias overlap. A spelling already recorded for someone, answered by the
 *      GIN index on normalized_aliases.
 *   3. The subset rule from namesMatch - "Jane Doe" against a stored "Jane Ann
 *      Doe". This one cannot be an index lookup, so it is scoped to speakers
 *      sharing a surname rather than run over the table.
 *
 * Creating is the fallback, never the first move: a duplicate speaker splits a
 * person's timeline silently, which is the failure this module exists to
 * prevent.
 */
export async function resolveSpeaker(
  rawName: string,
  options: { party?: string | null; role?: string | null } = {},
): Promise<Speaker | null> {
  const normalized = normalizeSpeakerName(rawName)
  // "Rep." on its own, an empty string, or a stray honorific normalizes to
  // nothing. That is not a person, and inventing a speaker row for it would
  // give every unattributed insight in the database the same fake identity.
  if (!normalized) return null

  const existing = await findSpeakerByName(rawName)
  if (existing) return rememberSpelling(existing, rawName, options)

  const [created] = await db
    .insert(speakers)
    .values({
      name: rawName.trim(),
      normalizedName: normalized,
      normalizedAliases: aliasSet([rawName]),
      party: options.party ?? null,
      role: options.role ?? null,
    })
    // Two documents processed concurrently can both miss and both insert. The
    // unique index decides, and the loser re-reads rather than failing a whole
    // pipeline run over a name collision.
    .onConflictDoNothing({ target: speakers.normalizedName })
    .returning()

  if (created) return toSpeaker(created)

  const [raced] = await db
    .select()
    .from(speakers)
    .where(eq(speakers.normalizedName, normalized))
    .limit(1)

  return raced ? toSpeaker(raced) : null
}

/** Lookup only. Returns null rather than creating, for read paths. */
export async function findSpeakerByName(rawName: string): Promise<Speaker | null> {
  if (!hasDatabase) return null
  const normalized = normalizeSpeakerName(rawName)
  if (!normalized) return null

  const [exact] = await db
    .select()
    .from(speakers)
    .where(eq(speakers.normalizedName, normalized))
    .limit(1)
  if (exact) return toSpeaker(exact)

  const [byAlias] = await db
    .select()
    .from(speakers)
    .where(sql`${speakers.normalizedAliases} && array[${normalized}]::text[]`)
    .limit(1)
  if (byAlias) return toSpeaker(byAlias)

  // The subset rule, scoped by surname so this is an index-assisted scan of a
  // handful of rows rather than a sequential scan of the table.
  const surname = normalized.split(" ").pop() ?? ""
  if (!surname) return null

  const candidatesBySurname = await db
    .select()
    .from(speakers)
    .where(sql`${speakers.normalizedName} like ${`% ${surname}`}`)
    .limit(25)

  for (const row of candidatesBySurname) {
    if (namesMatch(row.normalizedName, normalized)) return toSpeaker(row)
  }

  return null
}

export async function getSpeaker(id: string): Promise<Speaker | null> {
  if (!hasDatabase) return null
  const [row] = await db.select().from(speakers).where(eq(speakers.id, id)).limit(1)
  return row ? toSpeaker(row) : null
}

export interface SpeakerSummary extends Speaker {
  /** Published insights attributed to this person. */
  insightCount: number
  /** Of those, how many carry FLIP_FLOP. The timeline's headline number. */
  flipFlopCount: number
  /** Most recent published insight, for sorting a directory. */
  lastSeenAt: Date | null
}

/**
 * The speaker directory.
 *
 * Counts come from one grouped join rather than a subquery per row, because a
 * directory of fifty people would otherwise be a hundred and one queries. Only
 * published insights are counted: a reader is told how much is on record, and
 * rows held back from the feed are not on record.
 */
export async function listSpeakers(
  options: { limit?: number; search?: string } = {},
): Promise<SpeakerSummary[]> {
  if (!hasDatabase) return []

  const limit = Math.min(Math.max(1, options.limit ?? 50), 200)
  const search = options.search?.trim()
  const normalizedSearch = search ? normalizeSpeakerName(search) : ""

  const filter = normalizedSearch
    ? sql`where s.normalized_name like ${`%${normalizedSearch}%`}
             or s.normalized_aliases && array[${normalizedSearch}]::text[]`
    : sql``

  const rows = await db.execute<{
    [column: string]: unknown
    id: string
    name: string
    normalized_name: string
    normalized_aliases: string[] | null
    party: string | null
    role: string | null
    insight_count: string | number
    flip_flop_count: string | number
    last_seen_at: string | Date | null
  }>(sql`
    select
      s.id, s.name, s.normalized_name, s.normalized_aliases, s.party, s.role,
      count(i.id) filter (where i.status = 'published') as insight_count,
      count(i.id) filter (
        where i.status = 'published' and i.flags && array['FLIP_FLOP']::insight_flag[]
      ) as flip_flop_count,
      max(i.created_at) filter (where i.status = 'published') as last_seen_at
    from speakers s
    left join insights i on i.speaker_id = s.id
    ${filter}
    group by s.id
    order by count(i.id) filter (where i.status = 'published') desc, s.name asc
    limit ${limit}
  `)

  return [...rows].map((row) => ({
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    normalizedAliases: row.normalized_aliases ?? [],
    party: row.party,
    role: row.role,
    insightCount: Number(row.insight_count ?? 0),
    flipFlopCount: Number(row.flip_flop_count ?? 0),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
  }))
}

/**
 * Record a spelling, and upgrade the display name if this one is fuller.
 *
 * The alias list is what makes the next lookup an index hit instead of the
 * surname scan. The display-name upgrade is why "Rep. Doe" seen first does not
 * permanently become how the app names someone: the fullest spelling seen
 * wins, and titles never count toward fullness. See preferredDisplayName.
 */
async function rememberSpelling(
  speaker: Speaker,
  rawName: string,
  options: { party?: string | null; role?: string | null },
): Promise<Speaker> {
  const aliases = aliasSet([...speaker.normalizedAliases, speaker.normalizedName, rawName])
  const name = preferredDisplayName([speaker.name, rawName])

  const sameAliases =
    aliases.length === speaker.normalizedAliases.length &&
    aliases.every((a) => speaker.normalizedAliases.includes(a))
  const party = options.party ?? speaker.party
  const role = options.role ?? speaker.role

  if (sameAliases && name === speaker.name && party === speaker.party && role === speaker.role) {
    return speaker
  }

  const [updated] = await db
    .update(speakers)
    .set({ name, normalizedAliases: aliases, party, role, updatedAt: new Date() })
    .where(eq(speakers.id, speaker.id))
    .returning()

  return updated ? toSpeaker(updated) : { ...speaker, name, normalizedAliases: aliases }
}

/**
 * Give every candidate and insight a speaker.
 *
 * The migration deliberately leaves this to code: the matching rules are a
 * TypeScript function, and a SQL translation of them would drift on the first
 * title nobody thought of. Idempotent, so re-running it after a new spelling
 * shows up merges rather than duplicates.
 *
 * Written as a handful of bulk statements rather than as a loop over
 * `resolveSpeaker`, and that is not premature optimization. A ballot table has
 * one candidate row per person PER RACE, so it is an order of magnitude larger
 * than the set of people in it - a few thousand rows resolving to a few
 * hundred speakers is normal. A per-row loop is four or five round trips each,
 * which over a hosted database is tens of thousands of round trips and reads
 * as a hang rather than as slow.
 *
 * So: read everything once, resolve in memory with the same pure functions
 * `resolveSpeaker` uses, and write back in chunks.
 *
 * Insights are attached through their candidate rather than by re-matching
 * their own text, because the candidate row already holds the name extraction
 * resolved at the time, and re-deriving it would be a second, differently
 * wrong answer.
 */
export async function backfillSpeakers(): Promise<{
  speakersResolved: number
  speakersCreated: number
  candidatesLinked: number
  insightsLinked: number
}> {
  if (!hasDatabase) {
    return { speakersResolved: 0, speakersCreated: 0, candidatesLinked: 0, insightsLinked: 0 }
  }

  const rows = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      party: candidates.party,
      speakerId: candidates.speakerId,
    })
    .from(candidates)

  // One person appears once per race, so the same name arrives many times.
  // Group first and every later step is per person rather than per row.
  const groups = new Map<
    string,
    { normalized: string; names: string[]; party: string | null; candidateIds: string[] }
  >()

  for (const row of rows) {
    const normalized = normalizeSpeakerName(row.name)
    // Not a person. A bare title or an empty name would otherwise become a
    // speaker that every later unattributed mention resolves to.
    if (!normalized) continue

    const group = groups.get(normalized)
    if (group) {
      if (!group.names.includes(row.name)) group.names.push(row.name)
      group.party = group.party ?? row.party
      group.candidateIds.push(row.id)
    } else {
      groups.set(normalized, {
        normalized,
        names: [row.name],
        party: row.party,
        candidateIds: [row.id],
      })
    }
  }

  const index = await speakerIndex()

  const toCreate: typeof speakers.$inferInsert[] = []
  const resolvedByNormalized = new Map<string, string>()
  const aliasUpdates: { id: string; name: string; aliases: string[] }[] = []

  for (const group of groups.values()) {
    const existing = matchInIndex(index, group.normalized)

    if (existing) {
      resolvedByNormalized.set(group.normalized, existing.id)

      const aliases = aliasSet([
        ...existing.normalizedAliases,
        existing.normalizedName,
        ...group.names,
      ])
      const name = preferredDisplayName([existing.name, ...group.names])
      const grew =
        aliases.length !== existing.normalizedAliases.length || name !== existing.name

      if (grew) {
        aliasUpdates.push({ id: existing.id, name, aliases })
        // Keep the in-memory index honest, so a later group that matches one
        // of these new aliases resolves to this speaker instead of creating a
        // second row for the same person.
        for (const alias of aliases) index.byName.set(alias, { ...existing, normalizedAliases: aliases })
      }
      continue
    }

    toCreate.push({
      name: preferredDisplayName(group.names),
      normalizedName: group.normalized,
      normalizedAliases: aliasSet(group.names),
      party: group.party,
    })
  }

  let speakersCreated = 0
  for (const chunk of chunks(toCreate, 500)) {
    const created = await db
      .insert(speakers)
      .values(chunk)
      .onConflictDoNothing({ target: speakers.normalizedName })
      .returning({ id: speakers.id, normalizedName: speakers.normalizedName })

    for (const row of created) resolvedByNormalized.set(row.normalizedName, row.id)
    speakersCreated += created.length
  }

  // Anything the conflict clause swallowed - a concurrent run, or a row this
  // function's own earlier pass created - is read back rather than assumed
  // missing. Without this those candidates would be left unlinked.
  const unresolved = toCreate
    .map((row) => row.normalizedName)
    .filter((normalized) => !resolvedByNormalized.has(normalized))

  for (const chunk of chunks(unresolved, 500)) {
    const found = await db
      .select({ id: speakers.id, normalizedName: speakers.normalizedName })
      .from(speakers)
      .where(inArray(speakers.normalizedName, chunk))

    for (const row of found) resolvedByNormalized.set(row.normalizedName, row.id)
  }

  for (const chunk of chunks(aliasUpdates, 200)) {
    const values = chunk.map(
      (u) => sql`(${u.id}::uuid, ${u.name}, ${toPgTextArray(u.aliases)}::text[])`,
    )
    await db.execute(sql`
      update speakers s
         set name = v.name,
             normalized_aliases = v.aliases,
             updated_at = now()
        from (values ${sql.join(values, sql`, `)}) as v(id, name, aliases)
       where s.id = v.id
    `)
  }

  // The links, in chunks. `speaker_id is null` is what makes this safe to
  // re-run: a correction made by hand is never stamped over.
  const links: { candidateId: string; speakerId: string }[] = []
  for (const group of groups.values()) {
    const speakerId = resolvedByNormalized.get(group.normalized)
    if (!speakerId) continue
    for (const candidateId of group.candidateIds) links.push({ candidateId, speakerId })
  }

  let candidatesLinked = 0
  for (const chunk of chunks(links, 1000)) {
    const values = chunk.map((l) => sql`(${l.candidateId}::uuid, ${l.speakerId}::uuid)`)
    const updated = await db.execute<{ [column: string]: unknown; id: string }>(sql`
      update candidates c
         set speaker_id = v.speaker_id
        from (values ${sql.join(values, sql`, `)}) as v(candidate_id, speaker_id)
       where c.id = v.candidate_id
         and c.speaker_id is null
      returning c.id
    `)
    candidatesLinked += [...updated].length
  }

  // One statement: the join is the whole mapping, and it only touches rows
  // that do not already have a speaker.
  const linked = await db.execute<{ [column: string]: unknown; id: string }>(sql`
    update insights i
       set speaker_id = c.speaker_id
      from candidates c
     where c.id = i.candidate_id
       and c.speaker_id is not null
       and i.speaker_id is null
    returning i.id
  `)

  return {
    speakersResolved: resolvedByNormalized.size,
    speakersCreated,
    candidatesLinked,
    insightsLinked: [...linked].length,
  }
}

/**
 * Every speaker, indexed the three ways a lookup asks for one.
 *
 * `byName` covers the exact and alias cases; `bySurname` is what the subset
 * rule scans, and it is a bucket rather than the whole table because
 * `namesMatch` can only ever match names sharing a last token.
 */
interface SpeakerIndex {
  byName: Map<string, Speaker>
  bySurname: Map<string, Speaker[]>
}

async function speakerIndex(): Promise<SpeakerIndex> {
  const rows = await db.select().from(speakers)
  const byName = new Map<string, Speaker>()
  const bySurname = new Map<string, Speaker[]>()

  for (const row of rows) {
    const speaker = toSpeaker(row)
    // The canonical name is set last so it wins over an alias another speaker
    // happens to share. Two people cannot both own a normalized name: the
    // unique index says so.
    for (const alias of speaker.normalizedAliases) {
      if (!byName.has(alias)) byName.set(alias, speaker)
    }
    byName.set(speaker.normalizedName, speaker)

    const surname = speaker.normalizedName.split(" ").pop() ?? ""
    if (!surname) continue
    const bucket = bySurname.get(surname)
    if (bucket) bucket.push(speaker)
    else bySurname.set(surname, [speaker])
  }

  return { byName, bySurname }
}

/** The same three steps findSpeakerByName takes, against the in-memory index. */
function matchInIndex(index: SpeakerIndex, normalized: string): Speaker | null {
  const direct = index.byName.get(normalized)
  if (direct) return direct

  const surname = normalized.split(" ").pop() ?? ""
  if (!surname) return null

  for (const speaker of index.bySurname.get(surname) ?? []) {
    if (namesMatch(speaker.normalizedName, normalized)) return speaker
  }

  return null
}

function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size)
}

/**
 * A Postgres text[] literal.
 *
 * Needed because the alias list is bound inside a VALUES row rather than
 * through drizzle's column mapping, and a JS array bound as a single parameter
 * arrives as a malformed array literal. Backslashes and quotes are escaped;
 * every value here is already normalized to letters, digits, spaces, hyphens
 * and apostrophes, so this is a belt on top of braces.
 */
function toPgTextArray(values: readonly string[]): string {
  const escaped = values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
  return `{${escaped.join(",")}}`
}

function toSpeaker(row: typeof speakers.$inferSelect): Speaker {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalizedName,
    normalizedAliases: row.normalizedAliases ?? [],
    party: row.party,
    role: row.role,
  }
}
