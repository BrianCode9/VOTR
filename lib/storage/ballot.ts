import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { candidates, districts, races } from "@/db/schema"
import { resolveSpeaker } from "./speakers"

/**
 * Ballot scaffolding: districts, races, candidates.
 *
 * Candidate resolution here is by name within one race, which is a placeholder
 * for real address-to-district resolution. It is isolated in this module so
 * that replacing it does not touch the pipeline: the pipeline asks for "the
 * candidate id for this name" and does not know how the answer is produced.
 */

export const DEMO_BALLOT = {
  districtType: "congressional",
  districtName: "Demo district",
  state: "US",
  geoId: "DEMO-01",
  office: "U.S. House",
  level: "federal" as const,
  electionDate: new Date("2026-11-03"),
}

/** Create the demo district and race once, and return the race id. */
export async function ensureDemoRace(): Promise<string> {
  let [district] = await db
    .select()
    .from(districts)
    .where(eq(districts.geoId, DEMO_BALLOT.geoId))

  if (!district) {
    ;[district] = await db
      .insert(districts)
      .values({
        type: DEMO_BALLOT.districtType,
        name: DEMO_BALLOT.districtName,
        state: DEMO_BALLOT.state,
        geoId: DEMO_BALLOT.geoId,
      })
      .onConflictDoNothing({ target: districts.geoId })
      .returning()

    if (!district) {
      ;[district] = await db
        .select()
        .from(districts)
        .where(eq(districts.geoId, DEMO_BALLOT.geoId))
    }
  }

  const [race] = await db.select().from(races).where(eq(races.districtId, district.id))
  if (race) return race.id

  const [created] = await db
    .insert(races)
    .values({
      districtId: district.id,
      office: DEMO_BALLOT.office,
      electionDate: DEMO_BALLOT.electionDate,
      level: DEMO_BALLOT.level,
    })
    .returning()

  return created.id
}

/**
 * Find or create a candidate by the name the document used.
 *
 * Still name-and-race matching, so "Rep. Jane Doe" and "Jane Doe" remain two
 * candidate ROWS. What changed is that both now carry the same `speaker_id`:
 * identity moved to `speakers`, where normalization collapses the two
 * spellings, and everything that needs a person rather than a ballot line -
 * stance history, the timeline, corroboration - reads that column instead.
 *
 * The candidate row is kept as it was rather than deduplicated here, because a
 * candidate is genuinely per race and merging them would lose which race a
 * card belongs to. Real address-to-district resolution is still step 7.
 */
export async function resolveCandidate(
  raceId: string,
  name: string,
): Promise<{ candidateId: string; speakerId: string | null }> {
  const trimmed = name.trim()
  const speaker = await resolveSpeaker(trimmed)
  const speakerId = speaker?.id ?? null

  const [found] = await db
    .select({ id: candidates.id, speakerId: candidates.speakerId })
    .from(candidates)
    .where(and(eq(candidates.raceId, raceId), eq(candidates.name, trimmed)))
    .limit(1)

  if (found) {
    // A candidate created before speakers existed, or before this name
    // resolved to one, is linked on the next sighting rather than left
    // dangling. Never overwritten: a correction made by hand survives.
    if (!found.speakerId && speakerId) {
      await db
        .update(candidates)
        .set({ speakerId })
        .where(eq(candidates.id, found.id))
    }
    return { candidateId: found.id, speakerId: speakerId ?? found.speakerId }
  }

  const [created] = await db
    .insert(candidates)
    .values({ raceId, name: trimmed, party: null, incumbent: false, speakerId })
    .returning({ id: candidates.id })

  return { candidateId: created.id, speakerId }
}
