import { NextResponse } from "next/server"
import { generateShareImage, shareImageBytes } from "@/lib/share/generate"

/**
 * /api/insights/:id/share
 *
 *   GET   the share card's metadata and URL, generating it if needed
 *   POST  the same, and ?force=true re-renders instead of using the cache
 *
 *   ?raw=true   respond with the image bytes directly instead of the JSON
 *
 * The contract is the point here, not the artwork. A caller gets back a
 * stable, cacheable URL plus the image itself, and the template is a
 * placeholder that lib/share/template.ts can replace without any of this
 * changing.
 *
 * Generation is cached on (insight, template), which doubles as the rate
 * limit: however many people share a card, it renders once.
 */

export const dynamic = "force-dynamic"

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(request, ctx, false)
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(request, ctx, true)
}

async function handle(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  allowForce: boolean,
) {
  const { id } = await params
  const search = new URL(request.url).searchParams

  try {
    const image = await generateShareImage(id, {
      force: allowForce && search.get("force") === "true",
    })

    if (!image) {
      return NextResponse.json(
        { error: "insight not found, or its stored quote span no longer fits its document" },
        { status: 404 },
      )
    }

    if (search.get("raw") === "true") {
      return new NextResponse(new Uint8Array(shareImageBytes(image)), {
        headers: {
          "content-type": image.contentType,
          "cache-control": "public, max-age=31536000, immutable",
        },
      })
    }

    return NextResponse.json({
      insightId: image.insightId,
      shareImageId: image.id,
      url: image.url,
      contentType: image.contentType,
      width: image.width,
      height: image.height,
      template: image.template,
      cached: image.cached,
    })
  } catch (e) {
    console.error("share image generation failed", e)
    return NextResponse.json({ error: "share image generation failed" }, { status: 500 })
  }
}
