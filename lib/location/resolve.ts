import { stateByFips, parseState, type StateInfo } from "./states"

/**
 * Address to district.
 *
 * Step 7 of the build order. The rule this module is built around: a reader
 * who typed something must always end up somewhere. A state is enough to draw
 * a ballot, and a congressional district only narrows it, so every failure
 * path here degrades to the state rather than to an error page.
 *
 * The Census geocoder is used because it needs no key, no account and no
 * quota negotiation, and because it is the authority the district boundaries
 * actually come from. It is also sometimes slow, which is why every call is
 * behind a hard timeout and a catch.
 */

export interface ResolvedLocation {
  /** USPS code. Always present; this is what the ballot is drawn from. */
  state: string
  /**
   * Congressional district number as a string, e.g. "38", or "AL" for an
   * at-large state. Null when only a state was resolved.
   */
  district: string | null
  /** What the geocoder matched, for showing the reader what we understood. */
  matchedAddress: string | null
  /** How we got here. The UI says so rather than implying false precision. */
  precision: "district" | "state"
}

const GEOCODER = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress"
const TIMEOUT_MS = 6000

/**
 * The district geo_id as stored in `districts.geo_id`.
 *
 * Written here, next to the parser that produces the parts, so the format
 * cannot drift away from the importer that wrote the rows.
 */
export function congressionalGeoId(state: string, district: string): string {
  return `US-${state.toUpperCase()}-congressional-${district}`
}

/** Census codes that are not a district anyone is elected from. */
const RESERVED_DISTRICT_CODES = new Set(["98", "99"])

/**
 * The district number out of a Census code.
 *
 * Accepts either a full GEOID (state FIPS followed by the two-digit district,
 * e.g. "4807") or a bare CD field ("07"), because the layer that carries them
 * is renamed every Congress and only one of the two is reliably present.
 *
 * Two cases that look like districts and are not:
 *
 * - `98` is a delegate or resident-commissioner seat (DC, PR, the
 *   territories). It parses as a number and would produce a plausible-looking
 *   "district 98" that no one votes in.
 * - `99` is Census for "district not defined".
 *
 * At-large states are NOT in that set. They come back as `00`, the importer
 * wrote them as `US-WY-congressional-0`, and the leading zero is stripped here
 * so the two agree.
 */
export function parseDistrictCode(raw: string | null | undefined): string | null {
  if (!raw) return null
  // A GEOID is state FIPS plus district; a bare CD field is the district alone.
  const code = raw.length > 2 ? raw.slice(-2) : raw
  if (!/^\d{1,2}$/.test(code)) return null
  if (RESERVED_DISTRICT_CODES.has(code.padStart(2, "0"))) return null
  return code.replace(/^0+(?=\d)/, "")
}

interface CensusGeography {
  STATE?: string
  BASENAME?: string
  STUSAB?: string
  [key: string]: unknown
}

/**
 * Pulls the district out of a geographies object whose key names move.
 *
 * The layer is named for the sitting Congress ("119th Congressional
 * Districts"), so it is renamed every two years. Matching the key by pattern
 * rather than by literal means the next renumbering is not an outage.
 */
function readDistrict(geographies: Record<string, CensusGeography[]>): {
  state: StateInfo | null
  district: string | null
} {
  let state: StateInfo | null = null
  let district: string | null = null

  for (const [layer, entries] of Object.entries(geographies)) {
    const entry = entries?.[0]
    if (!entry) continue

    if (/congressional district/i.test(layer)) {
      const geoid = typeof entry.GEOID === "string" ? entry.GEOID : null
      const cdKey = Object.keys(entry).find((k) => /^CD\d+$/.test(k))
      district = parseDistrictCode(geoid ?? (cdKey ? String(entry[cdKey]) : null))
      if (entry.STATE) state ??= stateByFips(entry.STATE)
    }

    if (/^states$/i.test(layer) && entry.STUSAB) {
      state ??= parseState(String(entry.STUSAB))
    }
  }

  return { state, district }
}

/**
 * Geocodes free text to a state and, when the address is specific enough, a
 * congressional district.
 *
 * Returns null only when nothing at all could be read, which leaves the caller
 * on whatever state the reader picked.
 */
export async function geocode(address: string): Promise<ResolvedLocation | null> {
  const query = address.trim()
  if (query.length < 3) return null

  const url = new URL(GEOCODER)
  url.searchParams.set("address", query)
  url.searchParams.set("benchmark", "Public_AR_Current")
  url.searchParams.set("vintage", "Current_Current")
  url.searchParams.set("layers", "all")
  url.searchParams.set("format", "json")

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
      // The boundaries move once a decade. A day of edge cache is generous and
      // still keeps a demo from hammering a public service.
      next: { revalidate: 86400 },
    })
    if (!response.ok) return null

    const body = (await response.json()) as {
      result?: {
        addressMatches?: {
          matchedAddress?: string
          geographies?: Record<string, CensusGeography[]>
        }[]
      }
    }

    const match = body.result?.addressMatches?.[0]
    if (!match?.geographies) return null

    const { state, district } = readDistrict(match.geographies)
    if (!state) return null

    return {
      state: state.code,
      district,
      matchedAddress: match.matchedAddress ?? null,
      precision: district ? "district" : "state",
    }
  } catch {
    // A timeout, a DNS failure, or a shape we did not expect. All three mean
    // the same thing to the reader: we could not narrow it, show the state.
    return null
  }
}

/**
 * Resolves the pair the form collects.
 *
 * The state select is the floor and the address is the refinement, so a
 * geocoder result is only accepted when it agrees with the state the reader
 * picked. Otherwise a typo'd address silently moves someone to another state's
 * ballot, which is worse than not narrowing at all.
 */
export async function resolveLocation(input: {
  state?: string | null
  address?: string | null
}): Promise<ResolvedLocation | null> {
  const picked = parseState(input.state)
  const address = input.address?.trim()

  if (address) {
    const geocoded = await geocode(address)
    if (geocoded && (!picked || geocoded.state === picked.code)) return geocoded
  }

  if (picked) {
    return { state: picked.code, district: null, matchedAddress: null, precision: "state" }
  }

  return null
}
