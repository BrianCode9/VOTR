import { NextResponse } from "next/server"
import {
  getCandidateTimeline,
  type TimelineInclude,
  type TimelineOrder,
} from "@/lib/queries/timeline"
import { getSpeaker, listSpeakers } from "@/lib/storage/speakers"
import { apiError } from "../version"
import { dateParam, intParam, isUuid } from "./params"

/**
 * GET /api/v1/speakers
 *
 * The people this app has anything on record for, most-covered first.
 *
 *   ?search=doe     matches the normalized name and every recorded spelling
 *   ?limit=50       capped at 200
 *
 * Counts are of PUBLISHED insights only. A reader is being told how much is on
 * the record, and a row held back from the feed is not on the record.
 */
export async function speakersGET(request: Request) {
  const params = new URL(request.url).searchParams

  try {
    const speakers = await listSpeakers({
      limit: intParam(params.get("limit")),
      search: params.get("search") ?? undefined,
    })

    return NextResponse.json({
      speakers: speakers.map((s) => ({
        id: s.id,
        name: s.name,
        party: s.party,
        role: s.role,
        // Exposed so a client can show why two spellings resolved to one
        // person, and so a search box can be honest about what it matched.
        normalizedAliases: s.normalizedAliases,
        insightCount: s.insightCount,
        flipFlopCount: s.flipFlopCount,
        lastSeenAt: s.lastSeenAt,
      })),
    })
  } catch (e) {
    console.error("speaker list failed", e)
    return NextResponse.json(apiError("server_error", "speaker list failed"), { status: 500 })
  }
}

/** GET /api/v1/speakers/:id - one person, without their timeline. */
export async function speakerGET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json(apiError("not_found", "speaker not found"), { status: 404 })
  }

  try {
    const speaker = await getSpeaker(id)
    if (!speaker) {
      return NextResponse.json(apiError("not_found", "speaker not found"), { status: 404 })
    }

    return NextResponse.json({ speaker })
  } catch (e) {
    console.error("speaker read failed", e)
    return NextResponse.json(apiError("server_error", "speaker read failed"), { status: 500 })
  }
}

/**
 * GET /api/v1/speakers/:id/timeline
 *
 * One person's stance history, oldest first, shaped for direct rendering.
 *
 *   ?topicId=<uuid|slug>   single-issue timeline. A slug works too
 *   ?from=2026-01-01       inclusive, ISO date or date-time
 *   ?to=2026-06-30         inclusive
 *   ?include=flip_flops|stance_changes
 *   ?order=asc|desc        default asc, which is what "chronological" means
 *   ?cursor=<opaque>       from the previous response
 *   ?limit=25              capped at 100
 *
 * `include` defaults to `flip_flops`, which is the conservative reading: the
 * badge means a change was detected AND cleared the confidence bar.
 * `stance_changes` widens it to every recorded shift, including the ones this
 * app is not willing to call a flip-flop. A client showing that mode must not
 * label the extra entries as flip-flops; every entry carries `flags` so it can
 * tell which is which without asking again.
 *
 * An unknown speaker is a 404. An unknown topic filter is an empty timeline
 * rather than an error: it is a filter that matches nothing, which is a true
 * answer, and the echoed `filters` block says what was applied.
 */
export async function speakerTimelineGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const search = new URL(request.url).searchParams

  if (!isUuid(id)) {
    return NextResponse.json(apiError("not_found", "speaker not found"), { status: 404 })
  }

  const order: TimelineOrder = search.get("order") === "desc" ? "desc" : "asc"
  const include: TimelineInclude =
    search.get("include") === "stance_changes" ? "stance_changes" : "flip_flops"

  try {
    const timeline = await getCandidateTimeline({
      speakerId: id,
      topicId: search.get("topicId"),
      from: dateParam(search.get("from")) ?? null,
      to: dateParam(search.get("to")) ?? null,
      order,
      include,
      limit: intParam(search.get("limit")),
      cursor: search.get("cursor"),
    })

    // A timeline with no speaker means the id resolved to nobody. An empty
    // entries array with a real speaker is a different thing - a person with
    // nothing on record yet - and a client has to be able to tell them apart.
    if (!timeline.speaker) {
      return NextResponse.json(apiError("not_found", "speaker not found"), { status: 404 })
    }

    return NextResponse.json(timeline)
  } catch (e) {
    console.error("timeline query failed", e)
    return NextResponse.json(apiError("server_error", "timeline query failed"), { status: 500 })
  }
}
