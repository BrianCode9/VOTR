import { NextResponse } from "next/server"
import {
  corroboratingSourcesFor,
  corroborateDocument,
  recomputeAllCorroboration,
  recomputeCorroborationFor,
} from "@/lib/storage/corroboration"
import { apiError } from "../version"
import { intParam, isUuid } from "./params"

/**
 * GET /api/v1/insights/:id/sources
 *
 * The full source-diversity list for one card, when the three inlined on the
 * feed item are not enough.
 *
 *   ?limit=10   capped at 50
 *
 * `sources` excludes the card's own outlet, because the card already knows
 * that one. `count` includes it, matching `sourceDiversity.count` on the feed
 * item, so the two numbers a client shows never disagree.
 */
export async function insightSourcesGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json(apiError("not_found", "insight not found"), { status: 404 })
  }

  try {
    const sources = await corroboratingSourcesFor(id, intParam(new URL(request.url).searchParams.get("limit")) ?? 10)

    return NextResponse.json({
      insightId: id,
      count: sources.length + 1,
      sources,
    })
  } catch (e) {
    console.error("corroborating sources read failed", e)
    return NextResponse.json(
      apiError("server_error", "corroborating sources read failed"),
      { status: 500 },
    )
  }
}

/**
 * POST /api/v1/jobs/corroborate
 *
 * The background hook. Re-scans and updates source-diversity counts when a new
 * corroborating document arrives.
 *
 *   { "documentId": "<uuid>" }   everything in one document, and its matches
 *   { "insightId": "<uuid>" }    one card, and its matches
 *   { "all": true }              the whole table. For a backfill, not a hook.
 *
 * The first two forms are incremental: they look only at insights that share a
 * speaker and a primary topic with the subject, which is the only set that can
 * contain a match. `all` reads every published insight and is the thing those
 * exist to avoid - it is here for the one-time backfill and for the demo
 * reseed, and `npm run corroborate` is the same call from a terminal.
 *
 * The pipeline already calls the document form after every ingest, so this
 * endpoint is for replaying a document whose peers arrived later, and for a
 * cron that wants to catch up after a failed run.
 *
 * Note what it never does: it does not create, edit, or delete an insight. The
 * worst a bad call can do is recompute a count to the same value.
 */
export async function corroborateJobPOST(request: Request) {
  let body: { documentId?: unknown; insightId?: unknown; all?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json(
      apiError("bad_request", "body must be JSON: { documentId } | { insightId } | { all: true }"),
      { status: 400 },
    )
  }

  const documentId = typeof body.documentId === "string" ? body.documentId : null
  const insightId = typeof body.insightId === "string" ? body.insightId : null
  const all = body.all === true

  if (!documentId && !insightId && !all) {
    return NextResponse.json(
      apiError("bad_request", "one of documentId, insightId, or all: true is required"),
      { status: 400 },
    )
  }

  if (documentId && !isUuid(documentId)) {
    return NextResponse.json(apiError("bad_request", "documentId must be a uuid"), {
      status: 400,
    })
  }
  if (insightId && !isUuid(insightId)) {
    return NextResponse.json(apiError("bad_request", "insightId must be a uuid"), {
      status: 400,
    })
  }

  try {
    const result = documentId
      ? await corroborateDocument(documentId)
      : insightId
        ? await recomputeCorroborationFor(insightId)
        : await recomputeAllCorroboration()

    return NextResponse.json({
      scope: documentId ? "document" : insightId ? "insight" : "all",
      scanned: result.scanned,
      linksWritten: result.linksWritten,
      // Only the rows whose count actually moved, so a cron's log is a diff
      // rather than a dump of everything it looked at.
      updated: result.updated,
    })
  } catch (e) {
    console.error("corroboration job failed", e)
    return NextResponse.json(apiError("server_error", "corroboration job failed"), {
      status: 500,
    })
  }
}
