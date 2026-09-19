import { insightSourcesGET } from "@/lib/api/handlers/corroboration"

/**
 * GET /api/v1/insights/:id/sources
 *
 * The full source-diversity list for one card. New in this version; there is
 * no unversioned equivalent. Handler: lib/api/handlers/corroboration.ts.
 */

export const dynamic = "force-dynamic"

export const GET = insightSourcesGET
