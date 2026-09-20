/**
 * The API version, and the shape of an error.
 *
 * Every endpoint lives at `/api/v1/...`. The unversioned paths that shipped
 * first still work and still return the same bodies - they are thin
 * re-exports of the same handler, see app/api - but they are frozen: a field
 * added in v1 appears there too because it is literally the same code, and a
 * field will never be REMOVED from either without a v2.
 *
 * What "additive only" means concretely, since a teammate is building against
 * this while it moves:
 *
 *   - A new field may appear on any response at any time. Ignore what you do
 *     not know.
 *   - An existing field will not change type, change meaning, or disappear.
 *   - A new value may be added to an enum. `confidence_label`, `flags`,
 *     `card_type` and the rest are all extensible, so branch with a default
 *     case rather than exhaustively.
 *   - A new query parameter may appear. Omitting it keeps the old behaviour.
 *
 * Anything that cannot be done additively gets `/api/v2`, and v1 keeps
 * answering until the frontend has moved.
 */

export const API_VERSION = "v1"

/**
 * The error body every endpoint returns.
 *
 * One shape, so a client writes one error path. `error` is for a human,
 * `code` is for a switch statement: the message is allowed to be reworded and
 * the code is not.
 */
export interface ApiError {
  error: string
  code: ApiErrorCode
  /** Field-level detail, when the failure is about a specific input. */
  details?: Record<string, unknown>
}

export const API_ERROR_CODES = [
  /** 400 - the request is malformed: bad JSON, a missing required parameter. */
  "bad_request",
  /** 400 - no reader id on an endpoint that needs one. See lib/api/identity.ts. */
  "missing_user",
  /** 404 - the thing asked for does not exist, or is not published. */
  "not_found",
  /** 422 - well-formed, but the values break a rule the client can fix. */
  "unprocessable",
  /** 500 - the server failed. Retrying is reasonable. */
  "server_error",
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export function apiError(
  code: ApiErrorCode,
  error: string,
  details?: Record<string, unknown>,
): ApiError {
  return details ? { error, code, details } : { error, code }
}

/** HTTP status for a code, so a route never picks a mismatched pair. */
export const STATUS_FOR_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  missing_user: 400,
  not_found: 404,
  unprocessable: 422,
  server_error: 500,
}
