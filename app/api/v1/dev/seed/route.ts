import {
  devSeedDELETE,
  devSeedGET,
  devSeedPOST,
} from "@/lib/api/handlers/dev-seed"

/**
 * GET, POST, DELETE /api/v1/dev/seed
 *
 * Demo fixtures, so the frontend can be built and shown without live model
 * calls. Disabled in production unless ALLOW_DEMO_SEED=true.
 * Handler: lib/api/handlers/dev-seed.ts.
 */

export const dynamic = "force-dynamic"

export const GET = devSeedGET
export const POST = devSeedPOST
export const DELETE = devSeedDELETE
