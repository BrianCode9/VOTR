import { NextResponse } from "next/server"
import { getShareImage, shareImageBytes } from "@/lib/share/generate"
import { apiError } from "../version"
import { UUID_RE } from "./params"

/**
 * GET /api/v1/share/:id
 *
 * Serves a generated share card. The id may carry the format's extension
 * (`<uuid>.svg`), because this URL ends up in an og:image tag and in chat
 * previews, and some of those clients decide whether to render a link by
 * looking at the path rather than at the content type.
 *
 * Immutable caching is safe: a share image's id is derived from an insight and
 * a template version, so the bytes behind a given id never change. Re-rendering
 * with a new template produces a new row and therefore a new id.
 */

export async function shareGET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const bare = id.replace(/\.(svg|png|jpg|jpeg)$/i, "")

  if (!UUID_RE.test(bare)) {
    return NextResponse.json(apiError("not_found", "not found"), { status: 404 })
  }

  try {
    const image = await getShareImage(bare)
    if (!image) return NextResponse.json(apiError("not_found", "not found"), { status: 404 })

    return new NextResponse(new Uint8Array(shareImageBytes(image)), {
      headers: {
        "content-type": image.contentType,
        "cache-control": "public, max-age=31536000, immutable",
        "content-disposition": `inline; filename="votr-${bare}"`,
      },
    })
  } catch (e) {
    console.error("share image read failed", e)
    return NextResponse.json(apiError("server_error", "share image read failed"), { status: 500 })
  }
}
