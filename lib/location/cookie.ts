import { cookies } from "next/headers"
import { parseState } from "./states"

/**
 * Where the reader votes, remembered without an account.
 *
 * "Works without an account" is a promise the For Me panel already makes, so
 * the location lives in a first-party cookie rather than in `user_profiles`.
 * It carries no identifier and nothing that is not already in the URL the
 * reader is looking at, which is why it does not need to be httpOnly and can
 * be read by the nav to render a "your ballot" link.
 *
 * `user_profiles` stays the home for an account-backed profile when there is
 * an account to back it.
 */

export const LOCATION_COOKIE = "votr_location"

export interface StoredLocation {
  state: string
  district: string | null
}

/** `CA` or `TX-7`. Small enough to read in a devtools cookie list. */
function encode(location: StoredLocation): string {
  return location.district ? `${location.state}-${location.district}` : location.state
}

function decode(raw: string | undefined): StoredLocation | null {
  if (!raw) return null
  const [code, district] = raw.split("-")
  const state = parseState(code)
  if (!state) return null
  return {
    state: state.code,
    district: district && /^\d+$/.test(district) ? district : null,
  }
}

/** The remembered location, or null. Safe to call from any Server Component. */
export async function readLocation(): Promise<StoredLocation | null> {
  const store = await cookies()
  return decode(store.get(LOCATION_COOKIE)?.value)
}

/**
 * Remembers a location.
 *
 * Only callable from a Server Function or Route Handler. HTTP cannot set a
 * cookie once the response has started streaming, so a Server Component
 * cannot do this. See the cookies() reference.
 */
export async function writeLocation(location: StoredLocation): Promise<void> {
  const store = await cookies()
  store.set(LOCATION_COOKIE, encode(location), {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 180,
  })
}

export async function clearLocation(): Promise<void> {
  const store = await cookies()
  store.delete(LOCATION_COOKIE)
}

/** The ballot URL for a location. One spelling, so links cannot drift. */
export function ballotPath(location: StoredLocation): string {
  return location.district
    ? `/ballot/${location.state}?district=${location.district}`
    : `/ballot/${location.state}`
}
