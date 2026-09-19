import { NextResponse } from "next/server"
import { MISSING_USER, userIdFrom } from "@/lib/api/identity"
import {
  clearProfile,
  getProfile,
  setSelectedTopics,
  validateTopicSelection,
} from "@/lib/storage/profiles"

/**
 * /api/profile
 *
 *   GET     the reader's selected topics, or null if they have not picked yet
 *   PUT     { topics: ["housing", "climate"] }   replaces the selection
 *   DELETE  clears it, back to the unpersonalized feed
 *
 * The reader is identified by the x-votr-session header, the votr_session
 * cookie, or a userId query parameter. See lib/api/identity.ts.
 *
 * The 2-to-3 pick bound is enforced here rather than in the database, and a
 * violation is a 422 with the reason, not a 500: it is a thing the client can
 * fix and should be told how to.
 */

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const userId = userIdFrom(request)
  if (!userId) return NextResponse.json(MISSING_USER, { status: 400 })

  try {
    const profile = await getProfile(userId)
    if (!profile) {
      // Not an error. A reader who has not onboarded gets the default feed,
      // and the client needs to be able to tell that from a failure.
      return NextResponse.json({ profile: null })
    }

    return NextResponse.json({
      profile: {
        userId: profile.userId,
        topics: profile.selectedTopics.map((t) => ({
          id: t.id,
          slug: t.slug,
          label: t.label,
        })),
        updatedAt: profile.updatedAt,
      },
    })
  } catch (e) {
    console.error("profile read failed", e)
    return NextResponse.json({ error: "profile read failed" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const userId = userIdFrom(request)
  if (!userId) return NextResponse.json(MISSING_USER, { status: 400 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 })
  }

  const topics = readTopics(body)
  if (!topics) {
    return NextResponse.json(
      { error: "body must be { topics: string[] } of topic slugs" },
      { status: 400 },
    )
  }

  try {
    const validation = await validateTopicSelection(topics)
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.reason, unknown: validation.unknown },
        { status: 422 },
      )
    }

    const profile = await setSelectedTopics(userId, validation.slugs)

    return NextResponse.json({
      profile: {
        userId: profile.userId,
        topics: profile.selectedTopics.map((t) => ({
          id: t.id,
          slug: t.slug,
          label: t.label,
        })),
        updatedAt: profile.updatedAt,
      },
    })
  } catch (e) {
    console.error("profile write failed", e)
    return NextResponse.json({ error: "profile write failed" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const userId = userIdFrom(request)
  if (!userId) return NextResponse.json(MISSING_USER, { status: 400 })

  try {
    const cleared = await clearProfile(userId)
    return NextResponse.json({ cleared })
  } catch (e) {
    console.error("profile delete failed", e)
    return NextResponse.json({ error: "profile delete failed" }, { status: 500 })
  }
}

function readTopics(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null
  const value = (body as { topics?: unknown }).topics
  if (!Array.isArray(value)) return null
  if (!value.every((v): v is string => typeof v === "string")) return null
  return value
}
