import {
  profileDELETE,
  profileGET,
  profilePUT,
} from "@/lib/api/handlers/profile"

/** GET, PUT, DELETE /api/v1/profile. Handler: lib/api/handlers/profile.ts. */

export const dynamic = "force-dynamic"

export const GET = profileGET
export const PUT = profilePUT
export const DELETE = profileDELETE
