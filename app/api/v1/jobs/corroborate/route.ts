import { corroborateJobPOST } from "@/lib/api/handlers/corroboration"

/**
 * POST /api/v1/jobs/corroborate
 *
 * The background hook that keeps source-diversity counts current as documents
 * arrive. Handler: lib/api/handlers/corroboration.ts.
 */

export const dynamic = "force-dynamic"

export const POST = corroborateJobPOST
