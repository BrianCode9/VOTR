import { NextResponse } from "next/server"
import { MAX_TOPICS, MIN_TOPICS } from "@/lib/storage/profiles"
import { loadTopics } from "@/lib/topics/taxonomy"

/**
 * GET /api/topics
 *
 * The issue taxonomy, for the onboarding picker.
 *
 *   ?includeInactive=true   also return retired topics
 *
 * The pick bounds are returned alongside the list rather than hardcoded in the
 * client, so the rule the API enforces and the rule the UI shows cannot drift
 * apart.
 */

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const includeInactive =
    new URL(request.url).searchParams.get("includeInactive") === "true"

  try {
    const all = await loadTopics()
    const topics = includeInactive ? all : all.filter((t) => t.active)

    return NextResponse.json({
      topics: topics.map((t) => ({
        id: t.id,
        slug: t.slug,
        label: t.label,
        description: t.description,
        active: t.active,
      })),
      selection: { min: MIN_TOPICS, max: MAX_TOPICS },
    })
  } catch (e) {
    console.error("topic list failed", e)
    return NextResponse.json({ error: "topic list failed" }, { status: 500 })
  }
}
