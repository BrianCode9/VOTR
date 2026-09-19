/**
 * Who is asking.
 *
 * There is no account system in this app yet. Readers are identified by an
 * anonymous session string that the client generates and sends, which is the
 * same thing `reactions.session_id` and `comments.session_id` already hold.
 *
 * This module is the single place that decides where that string is read from,
 * so that replacing it with a real authenticated subject later is a change to
 * one function rather than to every route. It deliberately does NOT mint an
 * identity of its own: a route that needs a reader and does not get one should
 * say so, not invent a user and write rows under it.
 */

/** Header the client sends. Also accepted as a query param for curl and tests. */
export const SESSION_HEADER = "x-votr-session"
export const SESSION_COOKIE = "votr_session"

/** Bounds on the identifier itself, so a junk value cannot become a table key. */
const MIN_LENGTH = 8
const MAX_LENGTH = 128
const ALLOWED = /^[A-Za-z0-9_-]+$/

export function isValidUserId(value: string): boolean {
  return value.length >= MIN_LENGTH && value.length <= MAX_LENGTH && ALLOWED.test(value)
}

/**
 * Read the reader's id from a request, or null.
 *
 * Header first, then cookie, then query string. The query string is last
 * because it is the least trustworthy of the three and the easiest to leak
 * into a log or a referrer; it is supported at all so the endpoints can be
 * exercised from a terminal.
 */
export function userIdFrom(request: Request): string | null {
  const header = request.headers.get(SESSION_HEADER)
  if (header && isValidUserId(header.trim())) return header.trim()

  const cookie = readCookie(request.headers.get("cookie"), SESSION_COOKIE)
  if (cookie && isValidUserId(cookie)) return cookie

  const param = new URL(request.url).searchParams.get("userId")
  if (param && isValidUserId(param.trim())) return param.trim()

  return null
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return decodeURIComponent(rest.join("="))
  }
  return null
}

/** The 400 body for a route that requires a reader and did not get one. */
export const MISSING_USER = {
  error: `no reader id. Send a ${SESSION_HEADER} header, a ${SESSION_COOKIE} cookie, ` +
    `or a userId query parameter. It must be 8 to 128 characters of [A-Za-z0-9_-].`,
}
