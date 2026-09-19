import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { candidates, districts, races } from "@/db/schema"

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
 * Name-only matching means "Rep. Jane Doe" and "Jane Doe" become two people.
 * That is a known limitation of the demo ballot and the reason this lives
 * behind a function rather than being inlined at the call site.
 */
export async function resolveCandidate(raceId: string, name: string): Promise<string> {
  const trimmed = name.trim()

  const [found] = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(and(eq(candidates.raceId, raceId), eq(candidates.name, trimmed)))
    .limit(1)
  if (found) return found.id

  const [created] = await db
    .insert(candidates)
    .values({ raceId, name: trimmed, party: null, incumbent: false })
    .returning({ id: candidates.id })

  return created.id
}
