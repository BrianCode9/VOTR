import { feedGET } from "@/lib/api/handlers/feed"

/**
 * GET /api/v1/feed
 *
 * The handler is lib/api/handlers/feed.ts, which app/api/feed also serves so
 * the versioned and unversioned paths cannot drift. Full contract, parameters
 * and response shape: docs/openapi.yaml.
 */

export const dynamic = "force-dynamic"

export const GET = feedGET
