import { NextResponse } from "next/server"
import { MISSING_USER, userIdFrom } from "@/lib/api/identity"
import {
  countSavedInsights,
  listSavedInsights,
  saveInsight,
  unsaveInsight,
} from "@/lib/storage/saved"

/**
 * /api/saved
 *
 *   GET     the reader's saved cards, newest save first, cursor-paginated
 *   POST    { insightId }   save. Idempotent: saving twice is not an error
 *   DELETE  ?insightId=...  unsave. Removing a save that is not there is fine
 *
 * Both writes are idempotent by design, because the client is a swipe on a
 * phone: a double-tap, a retry after a dropped connection, and a second tab
 * must all converge on the same single row. The uniqueness guarantee lives on
 * the table, not in a check here; see lib/storage/saved.ts.
 */

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const userId = userIdFrom(request)
  if (!userId) return NextResponse.json(MISSING_USER, { status: 400 })

  const params = new URL(request.url).searchParams
  const limitParam = Number(params.get("limit"))

  try {
    const page = await listSavedInsights(userId, {
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
      cursor: params.get("cursor"),
    })

    return NextResponse.json({ ...page, total: await countSavedInsights(userId) })
  } catch (e) {
    console.error("saved list failed", e)
    return NextResponse.json({ error: "saved list failed" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const userId = userIdFrom(request)
  if (!userId) return NextResponse.json(MISSING_USER, { status: 400 })

  let insightId: string | null
  try {
    const body = (await request.json()) as { insightId?: unknown }
    insightId = typeof body.insightId === "string" ? body.insightId : null
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 })
  }

  if (!insightId || !UUID_RE.test(insightId)) {
    return NextResponse.json(
      { error: "body must be { insightId: <uuid> }" },
      { status: 400 },
    )
  }

  try {
    const result = await saveInsight(userId, insightId)
    if (!result) {
      return NextResponse.json({ error: "insight not found" }, { status: 404 })
    }

    // 200 rather than 201 on a repeat: the resource exists either way, and a
    // client retrying after a timeout should not have to tell the two apart.
    return NextResponse.json(result, { status: result.alreadySaved ? 200 : 201 })
  } catch (e) {
    console.error("save failed", e)
    return NextResponse.json({ error: "save failed" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const userId = userIdFrom(request)
  if (!userId) return NextResponse.json(MISSING_USER, { status: 400 })

  const insightId = new URL(request.url).searchParams.get("insightId")
  if (!insightId || !UUID_RE.test(insightId)) {
    return NextResponse.json({ error: "insightId query parameter required" }, { status: 400 })
  }

  try {
    const removed = await unsaveInsight(userId, insightId)
    // Not a 404 when there was nothing to remove: the caller asked for this
    // card not to be saved, and after this request it is not saved.
    return NextResponse.json({ removed })
  } catch (e) {
    console.error("unsave failed", e)
    return NextResponse.json({ error: "unsave failed" }, { status: 500 })
  }
}
