import { savedDELETE, savedGET, savedPOST } from "@/lib/api/handlers/saved"

/** GET, POST, DELETE /api/v1/saved. Handler: lib/api/handlers/saved.ts. */

export const dynamic = "force-dynamic"

export const GET = savedGET
export const POST = savedPOST
export const DELETE = savedDELETE
