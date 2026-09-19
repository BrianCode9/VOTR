import { NextResponse } from "next/server"
import { getSourceContext } from "@/lib/queries/source-context"

/**
 * GET /api/insights/:id/source
 *
 * Powers "see original": the full stored document, the exact span to
 * highlight, and the source URL.
 *
 *   ?full=false   omit rawText and return only the excerpt window
 *
 * The document returned is the copy stored at ingest, not a re-fetch of the
 * URL. That is what makes the highlight survive a publisher editing the page.
 */

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
    const context = await getSourceContext(id)
    if (!context) {
      return NextResponse.json({ error: "insight not found" }, { status: 404 })
    }

    // A whole article per card is a lot of payload for a preview. Callers that
    // only need the surrounding paragraphs can ask for the excerpt alone.
    if (new URL(request.url).searchParams.get("full") === "false") {
      const { rawText: _rawText, segments: _segments, ...rest } = context
      return NextResponse.json(rest)
    }

    return NextResponse.json(context)
  } catch (e) {
    console.error("source context failed", e)
    return NextResponse.json({ error: "source context failed" }, { status: 500 })
  }
}
