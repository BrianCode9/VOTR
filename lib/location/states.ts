/**
 * The states, as data.
 *
 * `districts.state` stores the two-letter USPS code, and the Census geocoder
 * answers in two-digit FIPS, so both directions are needed and both live here
 * rather than being re-derived at two call sites that could disagree.
 */

export interface StateInfo {
  /** USPS code. The join key against `districts.state`. */
  code: string
  name: string
  /** Census FIPS. What the geocoder returns. */
  fips: string
}

export const STATES: StateInfo[] = [
  { code: "AL", name: "Alabama", fips: "01" },
  { code: "AK", name: "Alaska", fips: "02" },
  { code: "AZ", name: "Arizona", fips: "04" },
  { code: "AR", name: "Arkansas", fips: "05" },
  { code: "CA", name: "California", fips: "06" },
  { code: "CO", name: "Colorado", fips: "08" },
  { code: "CT", name: "Connecticut", fips: "09" },
  { code: "DE", name: "Delaware", fips: "10" },
  { code: "DC", name: "District of Columbia", fips: "11" },
  { code: "FL", name: "Florida", fips: "12" },
  { code: "GA", name: "Georgia", fips: "13" },
  { code: "HI", name: "Hawaii", fips: "15" },
  { code: "ID", name: "Idaho", fips: "16" },
  { code: "IL", name: "Illinois", fips: "17" },
  { code: "IN", name: "Indiana", fips: "18" },
  { code: "IA", name: "Iowa", fips: "19" },
  { code: "KS", name: "Kansas", fips: "20" },
  { code: "KY", name: "Kentucky", fips: "21" },
  { code: "LA", name: "Louisiana", fips: "22" },
  { code: "ME", name: "Maine", fips: "23" },
  { code: "MD", name: "Maryland", fips: "24" },
  { code: "MA", name: "Massachusetts", fips: "25" },
  { code: "MI", name: "Michigan", fips: "26" },
  { code: "MN", name: "Minnesota", fips: "27" },
  { code: "MS", name: "Mississippi", fips: "28" },
  { code: "MO", name: "Missouri", fips: "29" },
  { code: "MT", name: "Montana", fips: "30" },
  { code: "NE", name: "Nebraska", fips: "31" },
  { code: "NV", name: "Nevada", fips: "32" },
  { code: "NH", name: "New Hampshire", fips: "33" },
  { code: "NJ", name: "New Jersey", fips: "34" },
  { code: "NM", name: "New Mexico", fips: "35" },
  { code: "NY", name: "New York", fips: "36" },
  { code: "NC", name: "North Carolina", fips: "37" },
  { code: "ND", name: "North Dakota", fips: "38" },
  { code: "OH", name: "Ohio", fips: "39" },
  { code: "OK", name: "Oklahoma", fips: "40" },
  { code: "OR", name: "Oregon", fips: "41" },
  { code: "PA", name: "Pennsylvania", fips: "42" },
  { code: "RI", name: "Rhode Island", fips: "44" },
  { code: "SC", name: "South Carolina", fips: "45" },
  { code: "SD", name: "South Dakota", fips: "46" },
  { code: "TN", name: "Tennessee", fips: "47" },
  { code: "TX", name: "Texas", fips: "48" },
  { code: "UT", name: "Utah", fips: "49" },
  { code: "VT", name: "Vermont", fips: "50" },
  { code: "VA", name: "Virginia", fips: "51" },
  { code: "WA", name: "Washington", fips: "53" },
  { code: "WV", name: "West Virginia", fips: "54" },
  { code: "WI", name: "Wisconsin", fips: "55" },
  { code: "WY", name: "Wyoming", fips: "56" },
]

const BY_CODE = new Map(STATES.map((s) => [s.code, s]))
const BY_FIPS = new Map(STATES.map((s) => [s.fips, s]))
const BY_NAME = new Map(STATES.map((s) => [s.name.toLowerCase(), s]))

/** Null rather than throwing: this reads URL segments and user input. */
export function stateByCode(code: string | undefined | null): StateInfo | null {
  if (!code) return null
  return BY_CODE.get(code.trim().toUpperCase()) ?? null
}

export function stateByFips(fips: string | undefined | null): StateInfo | null {
  if (!fips) return null
  return BY_FIPS.get(fips.trim().padStart(2, "0")) ?? null
}

/** Accepts "CA", "california", or "California". */
export function parseState(input: string | undefined | null): StateInfo | null {
  if (!input) return null
  const trimmed = input.trim()
  return BY_CODE.get(trimmed.toUpperCase()) ?? BY_NAME.get(trimmed.toLowerCase()) ?? null
}

export function stateName(code: string): string {
  return BY_CODE.get(code.toUpperCase())?.name ?? code
}
