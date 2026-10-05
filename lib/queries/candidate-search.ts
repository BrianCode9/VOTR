import { sql } from "drizzle-orm"
import { db, hasDatabase } from "@/db"
import { displayName } from "../format/name"
import { stateName } from "../location/states"

export const CANDIDATE_SEARCH_LIMIT = 50

export interface CandidateSearchResult {
  id: string
  name: string
  party: string
  incumbent: boolean
  office: string
  level: "federal" | "state" | "local"
  districtName: string
  state: string
  stateName: string
  certified: boolean
  currentOfficeholder: boolean
  positionCount: number
  photo: {
    imageUrl: string
    filePage: string
    creator: string | null
    licenseName: string
    licenseUrl: string | null
  } | null
}

export interface CandidateSearchResponse {
  items: CandidateSearchResult[]
  total: number
}

interface CandidateSearchRow {
  [column: string]: unknown
  candidate_id: string
  candidate_name: string
  party: string | null
  incumbent: boolean
  office: string
  level: "federal" | "state" | "local"
  district_name: string
  state: string
  certified: boolean
  current_officeholder: boolean
  position_count: number
  photo_url: string | null
  photo_file_page: string | null
  photo_creator: string | null
  photo_license_name: string | null
  photo_license_url: string | null
  total_count: number
}

/** Keep URLs and queries bounded while preserving names exactly as entered. */
export function normalizeCandidateSearch(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 80)
}

/**
 * Search real candidate filings by name.
 *
 * Results are alphabetical. Search relevance must not become a proxy ranking
 * on a civic surface, and a substring match is sufficient for a directory of
 * names. FEC status N records are excluded for the same reason they are absent
 * from ballot pages: filing paperwork alone did not make them candidates.
 */
export async function searchCandidates(
  value: string,
): Promise<CandidateSearchResponse | null> {
  const query = normalizeCandidateSearch(value)
  if (query.length < 2) return { items: [], total: 0 }
  if (!hasDatabase) return null

  try {
    const rows = await db.execute<CandidateSearchRow>(sql`
      select
        c.id as candidate_id,
        c.name as candidate_name,
        c.party,
        c.incumbent,
        r.office,
        r.level,
        d.name as district_name,
        d.state,
        (cs.candidacy_status <> 'fec_filing_not_ballot_verified') as certified,
        (cs.candidacy_status = 'current_officeholder') as current_officeholder,
        coalesce(pos.n, 0)::int as position_count,
        cp.image_url as photo_url,
        cp.file_page as photo_file_page,
        cp.creator as photo_creator,
        cp.license_name as photo_license_name,
        cp.license_url as photo_license_url,
        count(*) over()::int as total_count
      from candidates c
      join races r on r.id = c.race_id
      join districts d on d.id = r.district_id
      join lateral (
        select source.candidacy_status
          from candidate_sources source
         where source.candidate_id = c.id
           and coalesce(source.source_record->>'candidateStatusCode', 'C') <> 'N'
         order by
           (source.candidacy_status = 'fec_filing_not_ballot_verified'),
           source.source_key
         limit 1
      ) cs on true
      left join candidate_photos cp on cp.candidate_id = c.id
      left join lateral (
        select count(*)::int as n
          from insights i
         where i.candidate_id = c.id
           and i.status = 'published'
      ) pos on true
      where d.geo_id <> 'DEMO-01'
        and position(lower(${query}) in lower(c.name)) > 0
      order by lower(c.name), d.state, r.office, c.id
      limit ${CANDIDATE_SEARCH_LIMIT}
    `)

    const records = [...rows]
    return {
      total: records[0]?.total_count ?? 0,
      items: records.map((row) => ({
        id: row.candidate_id,
        name: displayName(row.candidate_name),
        party: row.party ?? "Unaffiliated",
        incumbent: row.incumbent,
        office: row.office,
        level: row.level,
        districtName: row.district_name,
        state: row.state,
        stateName: stateName(row.state),
        certified: row.certified,
        currentOfficeholder: row.current_officeholder,
        positionCount: row.position_count,
        photo:
          row.photo_url && row.photo_file_page && row.photo_license_name
            ? {
                imageUrl: row.photo_url,
                filePage: row.photo_file_page,
                creator: row.photo_creator,
                licenseName: row.photo_license_name,
                licenseUrl: row.photo_license_url,
              }
            : null,
      })),
    }
  } catch {
    return null
  }
}
