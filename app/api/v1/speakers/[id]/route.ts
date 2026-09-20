import { speakerGET } from "@/lib/api/handlers/speakers"

/** GET /api/v1/speakers/:id. Handler: lib/api/handlers/speakers.ts. */

export const dynamic = "force-dynamic"

export const GET = speakerGET
