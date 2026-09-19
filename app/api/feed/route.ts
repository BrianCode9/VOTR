import { NextResponse } from "next/server"
import { userIdFrom } from "@/lib/api/identity"
import { isInsightFlag, type InsightFlag } from "@/lib/flags/types"
import { getInsightFeed, type FeedSort, type TopicMode } from "@/lib/queries/feed"
import { CARD_TYPES, type CardType } from "@/lib/schemas/insight"
import { selectedTopicSlugs } from "@/lib/storage/profiles"
import { savedIdsAmong } from "@/lib/storage/saved"

/**
 * GET /api/feed
 *
 * Cursor-paginated insight feed.
 *
 *   ?cursor=<opaque>     from the previous response, absent for the first page
 *   ?limit=20            capped server-side
 *   ?sort=recent|relevant
 *   ?topics=housing,climate          explicit filter, independent of the profile
 *   ?cardTypes=stance_change,factual_claim
 *   ?flags=FLIP_FLOP,NEW             only cards carrying one of these badges
 *   ?candidateId=<uuid>
 *   ?topicMode=boost|strict          what the reader's profile does. default boost
 *   ?selectedTopics=housing,climate  override the stored profile for this request
 *
 * Personalization is keyed off the reader id (x-votr-session header, cookie,
 * or userId query param). With a profile, their issues are ranked first and
 * the rest of the feed follows; `topicMode=strict` hides the rest instead.
 * Without one, this is the unpersonalized feed - never an empty one.
 *
 * Cards that cite the same quote from the same document are collapsed to one,
 * with the rest listed in `alsoCited`.
 */

export const dynamic = "force-dynamic"

function csv(value: string | null): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams

  const limitParam = Number(params.get("limit"))
  const sortParam = params.get("sort")
  const sort: FeedSort = sortParam === "relevant" ? "relevant" : "recent"
  const topicMode: TopicMode = params.get("topicMode") === "strict" ? "strict" : "boost"

  const cardTypes = csv(params.get("cardTypes")).filter((t): t is CardType =>
    (CARD_TYPES as readonly string[]).includes(t),
  )
  const flags = csv(params.get("flags")).filter((f): f is InsightFlag => isInsightFlag(f))

  const userId = userIdFrom(request)

  try {
    // An explicit selectedTopics param wins over the stored profile, so the
    // picker can preview a selection before the reader commits to it.
    const override = csv(params.get("selectedTopics"))
    const selectedTopics =
      override.length > 0 ? override : await selectedTopicSlugs(userId)

    const page = await getInsightFeed({
      cursor: params.get("cursor"),
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
      sort,
      topics: csv(params.get("topics")),
      cardTypes,
      flags,
      candidateId: params.get("candidateId") ?? undefined,
      selectedTopics,
      topicMode,
    })

    // Fill in the save state for this page in one query, so the client does
    // not have to ask per card to know which hearts are filled.
    const saved = userId ? await savedIdsAmong(userId, page.items.map((i) => i.id)) : null

    return NextResponse.json({
      ...page,
      items: saved
        ? page.items.map((item) => ({ ...item, saved: saved.has(item.id) }))
        : page.items,
      personalization: {
        userId: userId ?? null,
        selectedTopics,
        topicMode,
        // False means the reader has no profile, so nothing was re-ranked.
        applied: selectedTopics.length > 0,
      },
    })
  } catch (e) {
    console.error("feed query failed", e)
    return NextResponse.json({ error: "feed query failed" }, { status: 500 })
  }
}
