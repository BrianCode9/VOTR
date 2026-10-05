/**
 * npm run federal:import             Validate only.
 * npm run federal:import -- --apply  Upsert every sitting member of Congress.
 */
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import postgres from "postgres"
import { z } from "zod"
import { normalizeSpeakerName } from "../lib/speakers/normalize"

const memberSchema = z.object({
  sourceKey: z.string().startsWith("congress:current:"),
  bioguideId: z.string().min(1),
  name: z.string().min(1),
  party: z.string().min(1),
  state: z.string().regex(/^[A-Z]{2}$/),
  chamber: z.enum(["senate", "house"]),
  office: z.string().min(1),
  district: z.string().min(1),
  termStart: z.string(),
  termEnd: z.string(),
  officialWebsite: z.string().url(),
  contactForm: z.string().url().nullable(),
  phone: z.string().nullable(),
  officeAddress: z.string().nullable(),
  biography: z.string().min(1),
}).passthrough()

const snapshotSchema = z.object({
  congress: z.literal(119),
  preparedAt: z.string(),
  source: z.object({ url: z.string().url(), sha256: z.string().length(64) }),
  verifiedAgainst: z.array(z.object({ name: z.string(), url: z.string().url(), expectedEntries: z.number() })),
  coverage: z.object({
    senators: z.literal(100),
    votingRepresentatives: z.number(),
    delegatesAndResidentCommissioner: z.literal(6),
    vacantVotingSeats: z.array(z.string()),
    totalOfficeholders: z.number(),
  }),
  members: z.array(memberSchema),
})

type Member = z.infer<typeof memberSchema>

function stableId(key: string): string {
  const h = createHash("sha256").update(`votr-federal-officeholders-v1:${key}`).digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

function geoId(member: Member): string {
  return member.chamber === "senate"
    ? `US-${member.state}-us_senate-statewide`
    : `US-${member.state}-congressional-${member.district}`
}

export function loadFederalOfficeholders() {
  const snapshot = snapshotSchema.parse(JSON.parse(readFileSync("data/candidates/federal-officeholders.json", "utf8")))
  const { coverage, members } = snapshot
  if (members.length !== coverage.totalOfficeholders) throw new Error("Coverage total does not match member rows")
  if (coverage.votingRepresentatives + coverage.vacantVotingSeats.length !== 435) throw new Error("House voting seats are incomplete")
  if (new Set(members.map((member) => member.bioguideId)).size !== members.length) throw new Error("Duplicate Bioguide ids")
  return snapshot
}

export async function main() {
  const snapshot = loadFederalOfficeholders()
  const districtRows = new Map<string, Record<string, unknown>>()
  const raceRows = new Map<string, Record<string, unknown>>()
  const candidateRows: Record<string, unknown>[] = []
  const sourceRows: Record<string, unknown>[] = []
  const speakerRows = new Map<string, Record<string, unknown>>()

  for (const member of snapshot.members) {
    const memberGeoId = geoId(member)
    const districtId = stableId(`district:${memberGeoId}`)
    const raceId = stableId(`race:${snapshot.congress}:${memberGeoId}:${member.office}`)
    const candidateId = stableId(`candidate:${member.bioguideId}`)
    const normalizedName = normalizeSpeakerName(member.name)
    const speakerId = stableId(`speaker:${normalizedName}`)
    const districtName = member.chamber === "senate"
      ? `${member.state} U.S. Senate`
      : member.district === "0"
        ? `${member.state} at-large congressional district`
        : `${member.state} congressional district ${member.district}`

    districtRows.set(memberGeoId, {
      id: districtId,
      type: member.chamber === "senate" ? "us_senate" : "congressional",
      name: districtName,
      state: member.state,
      geo_id: memberGeoId,
    })
    raceRows.set(raceId, {
      id: raceId,
      district_id: districtId,
      office: member.office,
      election_date: `${member.termEnd}T00:00:00Z`,
      level: "federal",
    })
    speakerRows.set(normalizedName, {
      id: speakerId,
      name: member.name,
      normalized_name: normalizedName,
      normalized_aliases: [normalizedName],
      party: member.party,
      role: `${member.office}, ${member.state}${member.chamber === "house" ? `-${member.district}` : ""}`,
    })
    candidateRows.push({
      id: candidateId,
      race_id: raceId,
      name: member.name,
      party: member.party,
      incumbent: true,
      speaker_id: speakerId,
    })
    sourceRows.push({
      source_key: member.sourceKey,
      candidate_id: candidateId,
      election_stage: "officeholder",
      candidacy_status: "current_officeholder",
      source_name: "United States Congress Legislators",
      source_url: snapshot.source.url,
      source_record: {
        ...member,
        datasetSha256: snapshot.source.sha256,
        preparedAt: snapshot.preparedAt,
        verifiedAgainst: snapshot.verifiedAgainst,
        votrBackground: {
          text: member.biography,
          sourceUrl: member.officialWebsite,
          sourceKind: "official_office",
        },
      },
      incumbent_known: true,
      campaign_website: member.officialWebsite,
      biography: null,
      fetched_at: snapshot.preparedAt,
    })
  }

  const report = {
    preparedAt: snapshot.preparedAt,
    coverage: snapshot.coverage,
    applied: false,
    inserted: { districts: 0, races: 0, speakers: 0, candidates: 0, sources: 0 },
    updated: { races: 0, candidates: 0, sources: 0 },
  }
  console.log("Validated", report)
  if (!process.argv.includes("--apply")) return report

  try { process.loadEnvFile(".env.local") } catch { /* CI may provide env directly. */ }
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is missing")
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 20 })
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("select pg_advisory_xact_lock(20862026)")

      const existingDistricts = await tx.unsafe("select id, geo_id from districts")
      const districtIds = new Map(existingDistricts.map((row) => [row.geo_id, row.id]))
      for (const [key, district] of districtRows) {
        const existingId = districtIds.get(key)
        if (!existingId) continue
        for (const race of raceRows.values()) if (race.district_id === district.id) race.district_id = existingId
        district.id = existingId
      }

      for (const district of districtRows.values()) {
        const inserted = await tx.unsafe("insert into districts select * from jsonb_populate_record(null::districts, $1::text::jsonb) on conflict (geo_id) do nothing returning 1", [JSON.stringify(district)])
        report.inserted.districts += inserted.length
      }

      for (const race of raceRows.values()) {
        const result = await tx.unsafe("insert into races select * from jsonb_populate_record(null::races, $1::text::jsonb) on conflict (id) do update set district_id=excluded.district_id,office=excluded.office,election_date=excluded.election_date,level=excluded.level returning (xmax = 0) as inserted", [JSON.stringify(race)])
        if (result[0]?.inserted) report.inserted.races++
        else report.updated.races++
      }

      const existingSpeakers = await tx.unsafe("select id, normalized_name from speakers")
      const speakerIds = new Map(existingSpeakers.map((row) => [row.normalized_name, row.id]))
      for (const [normalizedName, speaker] of speakerRows) {
        const existingId = speakerIds.get(normalizedName)
        if (existingId) speaker.id = existingId
        else {
          const inserted = await tx.unsafe("insert into speakers select * from jsonb_populate_record(null::speakers, $1::text::jsonb) on conflict (normalized_name) do nothing returning id", [JSON.stringify(speaker)])
          if (inserted.length) report.inserted.speakers++
          speaker.id = inserted[0]?.id ?? (await tx.unsafe("select id from speakers where normalized_name=$1", [normalizedName]))[0].id
        }
      }
      for (const candidate of candidateRows) {
        const member = snapshot.members.find((entry) => stableId(`candidate:${entry.bioguideId}`) === candidate.id)!
        candidate.speaker_id = speakerRows.get(normalizeSpeakerName(member.name))!.id
        const result = await tx.unsafe("insert into candidates select * from jsonb_populate_record(null::candidates, $1::text::jsonb) on conflict (id) do update set race_id=excluded.race_id,name=excluded.name,party=excluded.party,incumbent=true,speaker_id=excluded.speaker_id returning (xmax = 0) as inserted", [JSON.stringify(candidate)])
        if (result[0]?.inserted) report.inserted.candidates++
        else report.updated.candidates++
      }
      for (const source of sourceRows) {
        const result = await tx.unsafe("insert into candidate_sources select * from jsonb_populate_record(null::candidate_sources, $1::text::jsonb) on conflict (source_key) do update set candidate_id=excluded.candidate_id,election_stage=excluded.election_stage,candidacy_status=excluded.candidacy_status,source_name=excluded.source_name,source_url=excluded.source_url,source_record=excluded.source_record,incumbent_known=true,campaign_website=excluded.campaign_website,biography=excluded.biography,fetched_at=excluded.fetched_at returning (xmax = 0) as inserted", [JSON.stringify(source)])
        if (result[0]?.inserted) report.inserted.sources++
        else report.updated.sources++
      }

      const audit = await tx.unsafe("select count(*)::int as total,count(*) filter (where source_record->>'chamber'='senate')::int as senators,count(*) filter (where source_record->>'chamber'='house')::int as house from candidate_sources where candidacy_status='current_officeholder'")
      if (audit[0].total !== 539 || audit[0].senators !== 100 || audit[0].house !== 439) {
        throw new Error(`Database read-back failed: ${JSON.stringify(audit[0])}`)
      }
    })
    report.applied = true
    writeFileSync("data/candidates/federal-officeholders-import-report.json", `${JSON.stringify(report, null, 2)}\n`)
    console.log("COMMITTED", report)
    return report
  } finally {
    await sql.end()
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/import-federal-officeholders.ts")) {
  main().catch((error) => {
    console.error("Federal officeholder import failed:", error.code ?? error.name, error.message?.replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]"))
    process.exitCode = 1
  })
}
