import {
  insightShareGET,
  insightSharePOST,
} from "@/lib/api/handlers/insight-share"

/**
 * /api/insights/:id/share
 *
 * The unversioned alias of /api/v1/insights/:id/share. Same handler object, so the two cannot drift
 * apart: a field added to one appears in the other because it is the same
 * code. Kept because it shipped first and something may already call it. New
 * clients should use the versioned path; see lib/api/version.ts for what
 * "additive only" commits to.
 */

export const dynamic = "force-dynamic"

export const GET = insightShareGET
export const POST = insightSharePOST
