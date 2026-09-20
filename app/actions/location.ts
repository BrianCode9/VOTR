"use server"

import { redirect } from "next/navigation"
import { ballotPath, clearLocation, writeLocation } from "@/lib/location/cookie"
import { resolveLocation } from "@/lib/location/resolve"

/**
 * The one action the whole entry flow runs through.
 *
 * A Server Action runs as a POST against the page that invokes it and is
 * reachable by anyone who can send that POST, so everything here treats the
 * FormData as untrusted: the state is parsed against a fixed list and the
 * address only ever reaches the Census geocoder.
 *
 * It always redirects. There is no failure branch that leaves the reader on
 * the form wondering, because the floor (a state they picked from a list of
 * states that have ballots) is always enough to draw a ballot.
 */
export async function goToBallot(formData: FormData): Promise<void> {
  const state = formData.get("state")
  const address = formData.get("address")

  const resolved = await resolveLocation({
    state: typeof state === "string" ? state : null,
    address: typeof address === "string" ? address : null,
  })

  // Nothing usable. Back to the picker rather than to a ballot for a state
  // nobody chose.
  if (!resolved) redirect("/?unresolved=1")

  const location = { state: resolved.state, district: resolved.district }
  await writeLocation(location)

  // Revalidation is not needed: the ballot page reads the database per request
  // and the cookie write already re-renders the current route.
  redirect(ballotPath(location))
}

/** Forgets the saved location and returns to the picker. */
export async function forgetLocation(): Promise<void> {
  await clearLocation()
  redirect("/")
}
