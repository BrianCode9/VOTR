import { speakerTimelineGET } from "@/lib/api/handlers/speakers"

/**
 * GET /api/v1/speakers/:id/timeline
 *
 * One person's stance history, cursor-paginated the same way the feed is.
 * Handler: lib/api/handlers/speakers.ts.
 */

export const dynamic = "force-dynamic"

export const GET = speakerTimelineGET
