import { NextResponse } from "next/server"
import { resetDemoData, seedDemoData, demoDataSummary } from "@/lib/fixtures/seed"
import { apiError } from "../version"

/**
 * The fixture endpoints. Guarded, and guarded here rather than at the route.
 *
 * A frontend has to be buildable and demoable without an Anthropic key, a
 * crawl, or anyone's laptop being awake. These endpoints install a fixed set
 * of speakers, documents, and insights covering every enum value the UI
 * branches on, and reset it on demand, so a component can be developed against
 * data that does not move between two page loads.
 *
 * Why an endpoint at all, when `npm run seed:demo` exists: the person building
 * the frontend may not have database credentials or a terminal in this repo.
 * A POST they can curl is the difference between being blocked on someone else
 * and not.
 *
 * The guard is deliberately not an auth check. It is an environment check,
 * because the honest statement is "this must never exist in production", not
 * "this must be authenticated in production". `ALLOW_DEMO_SEED=true` turns it
 * on; outside production it is on by default, because a dev server that
 * refuses to seed itself is a dev server nobody uses.
 */

function seedingAllowed(): boolean {
  if (process.env.ALLOW_DEMO_SEED === "true") return true
  return process.env.NODE_ENV !== "production"
}

const FORBIDDEN = apiError(
  "not_found",
  "demo seeding is disabled. Set ALLOW_DEMO_SEED=true to enable it outside production.",
)

/**
 * GET /api/v1/dev/seed
 *
 * What the fixture set contains and whether it is currently installed. Safe to
 * call at any time; it writes nothing.
 */
export async function devSeedGET() {
  if (!seedingAllowed()) return NextResponse.json(FORBIDDEN, { status: 404 })

  try {
    return NextResponse.json(await demoDataSummary())
  } catch (e) {
    console.error("demo summary failed", e)
    return NextResponse.json(apiError("server_error", "demo summary failed"), { status: 500 })
  }
}

/**
 * POST /api/v1/dev/seed
 *
 *   {}                  install the fixtures, leaving anything else alone
 *   { "reset": true }   delete the fixture rows first, then install
 *
 * Idempotent either way: the documents are keyed by a fixed URL and the
 * insights by the existing (document, span, card type) dedup index, so calling
 * it twice converges rather than duplicating.
 *
 * `reset` removes only rows this fixture set created - the demo documents and
 * everything cascading from them, and the demo speakers. It never truncates a
 * table, because this endpoint has to be safe to point at the shared database
 * that the rest of the team's real data lives in.
 */
export async function devSeedPOST(request: Request) {
  if (!seedingAllowed()) return NextResponse.json(FORBIDDEN, { status: 404 })

  let reset = false
  try {
    const body = (await request.json()) as { reset?: unknown }
    reset = body?.reset === true
  } catch {
    // An empty body is the common case from a plain `curl -X POST`, and it
    // means "seed, do not reset". Not an error.
  }

  try {
    const result = reset ? await resetDemoData() : await seedDemoData()
    return NextResponse.json(result)
  } catch (e) {
    console.error("demo seed failed", e)
    return NextResponse.json(apiError("server_error", "demo seed failed"), { status: 500 })
  }
}

/** DELETE /api/v1/dev/seed - remove the fixture rows and install nothing. */
export async function devSeedDELETE() {
  if (!seedingAllowed()) return NextResponse.json(FORBIDDEN, { status: 404 })

  try {
    const result = await resetDemoData({ seed: false })
    return NextResponse.json(result)
  } catch (e) {
    console.error("demo reset failed", e)
    return NextResponse.json(apiError("server_error", "demo reset failed"), { status: 500 })
  }
}
