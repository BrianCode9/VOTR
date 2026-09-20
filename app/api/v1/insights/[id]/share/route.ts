import {
  insightShareGET,
  insightSharePOST,
} from "@/lib/api/handlers/insight-share"

/** GET, POST /api/v1/insights/:id/share. Handler: lib/api/handlers/insight-share.ts. */

export const dynamic = "force-dynamic"

export const GET = insightShareGET
export const POST = insightSharePOST
