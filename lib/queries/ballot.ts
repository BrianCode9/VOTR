import { sql } from "drizzle-orm"
import { db, hasDatabase } from "@/db"
import { displayName } from "../format/name"
import { congressionalGeoId } from "../location/resolve"
import { stateName } from "../location/states"

/**
 * The ballot for one place.
 *
 * This is the query the whole product now hangs off: a reader says where they
 * vote, and this returns every race and every certified candidate there, with
 * enough on each card to decide whether to open them.
 *
 * Two rules it enforces, both of them about not lying:
 *
 * 1. Only candidates with a `candidate_sources` row appear. Extraction creates
 *    a candidate row for any name it reads in an article, so the table also
 *    holds things like "Trump administration". Those have no certified filing
 *    behind them and are not people you can vote for.
 * 2. The demo district is excluded. It is stored under the fake state "US", so
 *    filtering on a real two-letter state already drops it, but the predicate
 *    is written explicitly because that is a coincidence, not a guarantee.
 *
 * Ordering is level, then office, then name as certified. There is no ranking
 * anywhere in this file and there must never be one: the order candidates
 * appear in is the easiest place for a civic app to accidentally make a
 * recommendation.
 */

export interface BallotCandidate {
  id: string
  /** Certified spelling, cased for reading. See lib/format/name.ts. */
  name: string
  party: string
  incumbent: boolean
  /** The official ballot designation, e.g. "Voting Rights Attorney". */
  ballotDesignation: string | null
  campaignWebsite: string | null
  /** Who certified this candidacy, and the document that says so. */
  source: { name: string; url: string } | null
  photo: {
    imageUrl: string
    filePage: string
    creator: string | null
    licenseName: string
    licenseUrl: string | null
  } | null
  /** Verified positions on the record. 0 is a real and common answer. */
  positionCount: number
  /**
   * Whether a state authority certified this candidacy for the ballot.
   *
   * False means the only proof we hold is a federal campaign-finance filing,
   * which is a statement of intent to run, not a place on a ballot.
   */
  certified: boolean
}

export interface BallotRace {
  id: string
  office: string
  level: "federal" | "state" | "local"
  electionDate: Date
  districtName: string
  districtGeoId: string
  candidates: BallotCandidate[]
}

export interface Ballot {
  state: string
  stateName: string
  /** Congressional district number, when the address resolved one we hold. */
  district: string | null
  /** True when a district was asked for and actually narrowed the ballot. */
  districtMatched: boolean
  /**
   * The races this reader actually votes in: every statewide office, plus
   * their congressional district once an address has resolved one.
   */
  races: BallotRace[]
  /**
   * Every other race in the state.
   *
   * Kept and returned rather than dropped, because they are real elections
   * happening to real neighbours, but held apart from `races`, because
   * presenting a race someone cannot vote in as "your ballot" is the same
   * class of error as inventing a candidate.
   *
   * State legislative districts live here even for a reader whose address
   * resolved, because a congressional district does not determine a state
   * house district and we do not hold the map that would.
   */
  otherRaces: BallotRace[]
  totals: { races: number; candidates: number; positions: number }
  nextElection: Date | null
  /**
   * What this ballot actually is.
   *
   * `certified` - every candidate was certified by a state election authority.
   * `filings`   - every candidate is an FEC campaign-finance filing. Real
   *               people who declared, but not a ballot anyone has finalised.
   * `mixed`     - both, which the page has to say rather than round off.
   *
   * Surfaced because the difference is the whole product. A page that prints
   * eleven FEC filers under "your ballot" is telling a voter something untrue
   * in exactly the way this app exists not to.
   */
  certification: "certified" | "filings" | "mixed"
}

/**
 * Whether a district covers the whole state.
 *
 * The importer writes `-statewide` as the final segment for offices elected
 * state-wide, including a U.S. Senate seat, and a district number for
 * everything else. That suffix is the only signal, so it is read in one place.
 */
function isStatewide(geoId: string): boolean {
  return geoId.endsWith("-statewide")
}

interface BallotRow {
  // drizzle's execute<T> requires an index signature on the row shape.
  [column: string]: unknown

  candidate_id: string
  candidate_name: string
  party: string | null
  incumbent: boolean
  ballot_designation: string | null
  campaign_website: string | null
  source_name: string | null
  source_url: string | null
  photo_url: string | null
  photo_file_page: string | null
  photo_creator: string | null
  photo_license_name: string | null
  photo_license_url: string | null
  position_count: number
  certified: boolean
  race_id: string
  office: string
  level: "federal" | "state" | "local"
  /** Raw SQL comes back as a string here, not a Date. Normalised on the way out. */
  election_date: string | Date
  district_name: string
  district_geo_id: string
}

function toCandidate(row: BallotRow): BallotCandidate {
  return {
    id: row.candidate_id,
    name: displayName(row.candidate_name),
    party: row.party ?? "Unaffiliated",
    incumbent: row.incumbent,
    ballotDesignation: row.ballot_designation,
    campaignWebsite: row.campaign_website,
    source:
      row.source_name && row.source_url
        ? { name: row.source_name, url: row.source_url }
        : null,
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
    positionCount: row.position_count,
    certified: row.certified,
  }
}

/**
 * Every race in a state, or just the ones one address votes in.
 *
 * `district` narrows the congressional race only. Statewide offices stay,
 * because they are on that reader's real ballot, and a "your ballot" view that
 * hid the governor's race would be wrong in the one way that matters.
 */
export async function getBallot(
  state: string,
  district?: string | null,
): Promise<Ballot | null> {
  const code = state.trim().toUpperCase()
  if (!hasDatabase) return null

  const districtGeoId = district ? congressionalGeoId(code, district) : null

  let rows: BallotRow[]
  try {
    rows = [
      ...(await db.execute<BallotRow>(sql`
        select
          c.id                     as candidate_id,
          c.name                   as candidate_name,
          c.party,
          c.incumbent,
          cs.biography             as ballot_designation,
          cs.campaign_website,
          cs.source_name,
          cs.source_url,
          cp.image_url             as photo_url,
          cp.file_page             as photo_file_page,
          cp.creator               as photo_creator,
          cp.license_name          as photo_license_name,
          cp.license_url           as photo_license_url,
          coalesce(pos.n, 0)::int  as position_count,
          (cs.candidacy_status <> 'fec_filing_not_ballot_verified') as certified,
          r.id                     as race_id,
          r.office,
          r.level,
          r.election_date,
          d.name                   as district_name,
          d.geo_id                 as district_geo_id
        from candidates c
        join candidate_sources cs on cs.candidate_id = c.id
        join races r on r.id = c.race_id
        join districts d on d.id = r.district_id
        left join candidate_photos cp on cp.candidate_id = c.id
        left join lateral (
          select count(*)::int as n
            from insights i
           where i.candidate_id = c.id
             and i.status = 'published'
        ) pos on true
        where d.state = ${code}
          and d.geo_id <> 'DEMO-01'
          -- FEC status "N" is "filed paperwork, not yet a statutory
          -- candidate". Those are people who may never appear on any ballot,
          -- and listing them beside certified candidates is the difference
          -- between a ballot and a mailing list. "C" and the state-certified
          -- rows survive.
          and coalesce(cs.source_record->>'candidateStatusCode', 'C') <> 'N'
        order by r.level, r.office, c.name
      `)),
    ]
  } catch {
    return null
  }

  if (rows.length === 0) return null

  // A district that resolved but is not in the data (a delegate seat, a map
  // we have not imported) must not empty the ballot. It only applies when it
  // actually matches rows.
  const districtMatched =
    districtGeoId !== null && rows.some((row) => row.district_geo_id === districtGeoId)

  /**
   * Yours when it is statewide, or when it is the exact district that
   * resolved. Everything else is someone else's race.
   */
  const isYours = (geoId: string) =>
    isStatewide(geoId) || (districtMatched && geoId === districtGeoId)

  const byRace = new Map<string, BallotRace>()
  for (const row of rows) {
    const race = byRace.get(row.race_id) ?? {
      id: row.race_id,
      office: row.office,
      level: row.level,
      electionDate: new Date(row.election_date),
      districtName: row.district_name,
      districtGeoId: row.district_geo_id,
      candidates: [],
    }
    race.candidates.push(toCandidate(row))
    byRace.set(row.race_id, race)
  }

  const all = [...byRace.values()]
  const races = all.filter((race) => isYours(race.districtGeoId))
  const otherRaces = all.filter((race) => !isYours(race.districtGeoId))
  const dates = races
    .map((race) => race.electionDate.getTime())
    .filter((t) => Number.isFinite(t))

  const certifiedCount = all.reduce(
    (n, race) => n + race.candidates.filter((c) => c.certified).length,
    0,
  )
  const candidateCount = all.reduce((n, race) => n + race.candidates.length, 0)
  const certification: Ballot["certification"] =
    certifiedCount === candidateCount
      ? "certified"
      : certifiedCount === 0
        ? "filings"
        : "mixed"

  return {
    state: code,
    stateName: stateName(code),
    district: districtMatched ? (district ?? null) : null,
    districtMatched,
    races,
    otherRaces,
    // Totals count the whole state, not just the focused set, so the number a
    // reader sees on the landing page matches the number on the ballot page.
    totals: {
      races: all.length,
      candidates: all.reduce((n, race) => n + race.candidates.length, 0),
      positions: all.reduce(
        (n, race) => n + race.candidates.reduce((m, c) => m + c.positionCount, 0),
        0,
      ),
    },
    nextElection: dates.length > 0 ? new Date(Math.min(...dates)) : null,
    certification,
  }
}

/**
 * Which states have a ballot to show.
 *
 * Drives the picker, so a reader can never choose an option that leads to an
 * empty page.
 */
export async function getStatesWithBallots(): Promise<
  { state: string; candidates: number; positions: number }[]
> {
  if (!hasDatabase) return []
  try {
    const rows = await db.execute<{
      state: string
      candidates: number
      positions: number
    }>(sql`
      select
        d.state,
        count(distinct c.id)::int as candidates,
        count(distinct i.id)::int as positions
      from districts d
      join races r on r.district_id = d.id
      join candidates c on c.race_id = r.id
      join candidate_sources cs on cs.candidate_id = c.id
      left join insights i on i.candidate_id = c.id and i.status = 'published'
      where d.geo_id <> 'DEMO-01'
      group by d.state
      order by d.state
    `)
    return [...rows]
  } catch {
    return []
  }
}

export interface CandidateProfile extends BallotCandidate {
  background: { text: string; sourceUrl: string; sourceKind: string } | null
  office: string
  level: "federal" | "state" | "local"
  districtName: string
  state: string
  stateName: string
  electionDate: Date | null
  /** The person, not the ballot line. What the timeline query takes. */
  speakerId: string | null
}

/** One candidate, for the profile page. Null when the id is not a real filing. */
export async function getCandidate(id: string): Promise<CandidateProfile | null> {
  if (!hasDatabase) return null
  // A malformed uuid is a 500 from Postgres rather than a 404 from us.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null
  }

  try {
    const rows = await db.execute<
      BallotRow & { state: string; speaker_id: string | null; background: CandidateProfile["background"] }
    >(sql`
      select
        c.id as candidate_id, c.name as candidate_name, c.party, c.incumbent,
        c.speaker_id,
        cs.source_record->'votrBackground' as background,
        cs.biography as ballot_designation, cs.campaign_website,
        cs.source_name, cs.source_url,
        cp.image_url as photo_url, cp.file_page as photo_file_page,
        cp.creator as photo_creator, cp.license_name as photo_license_name,
        cp.license_url as photo_license_url,
        (cs.candidacy_status <> 'fec_filing_not_ballot_verified') as certified,
        coalesce((select count(*) from insights i
                   where i.candidate_id = c.id and i.status = 'published'), 0)::int
          as position_count,
        r.id as race_id, r.office, r.level, r.election_date,
        d.name as district_name, d.geo_id as district_geo_id, d.state
      from candidates c
      join candidate_sources cs on cs.candidate_id = c.id
      join races r on r.id = c.race_id
      join districts d on d.id = r.district_id
      left join candidate_photos cp on cp.candidate_id = c.id
      where c.id = ${id}::uuid
      limit 1
    `)

    const row = [...rows][0]
    if (!row) return null

    return {
      ...toCandidate(row),
      office: row.office,
      level: row.level,
      districtName: row.district_name,
      state: row.state,
      stateName: stateName(row.state),
      electionDate: row.election_date ? new Date(row.election_date) : null,
      speakerId: row.speaker_id,
      background: row.background ?? null,
    }
  } catch {
    return null
  }
}

/**
 * The issues candidates in this state are actually on record about.
 *
 * Only topics with at least one verified position are returned, so the filter
 * strip on the ballot page can never offer a chip that leads to an empty page.
 * A state with no coverage yet returns an empty list and the strip does not
 * render, which is the honest version of that state.
 *
 * The topic of an insight is read the same way the feed reads it: the
 * `insight_topics` rows when they exist, and `issue_tag` when they do not.
 * Only the demo fixtures currently have the join rows, so reading the join
 * table alone returns nothing for every real candidate in the database. Two
 * surfaces disagreeing about what an insight is tagged with is worse than
 * either rule on its own, which is why this mirrors lib/queries/feed.ts.
 */
export async function getBallotTopics(
  state: string,
): Promise<{ slug: string; label: string; count: number }[]> {
  if (!hasDatabase) return []
  try {
    const rows = await db.execute<{ slug: string; label: string; count: number }>(sql`
      with scoped as (
        select
          i.id,
          coalesce(
            (select array_agg(t.slug order by it."primary" desc, t.sort_order)
               from insight_topics it
               join topics t on t.id = it.topic_id
              where it.insight_id = i.id),
            array[i.issue_tag]
          ) as slugs
        from insights i
        join candidates c on c.id = i.candidate_id
        join races r on r.id = c.race_id
        join districts d on d.id = r.district_id
       where d.state = ${state.trim().toUpperCase()}
         and d.geo_id <> 'DEMO-01'
         and i.status = 'published'
      )
      select t.slug, t.label, count(distinct s.id)::int as count
        from scoped s
        cross join lateral unnest(s.slugs) as u(slug)
        join topics t on t.slug = u.slug
       where t.slug <> 'other'
       group by t.slug, t.label
       order by count(distinct s.id) desc, t.label
    `)
    return [...rows]
  } catch {
    return []
  }
}
