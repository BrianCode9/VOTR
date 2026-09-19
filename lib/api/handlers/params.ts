/**
 * Query-string parsing, once.
 *
 * Every one of these returns `undefined` for absent-or-unparseable rather than
 * throwing or coercing. That is the rule the whole API follows: a junk `limit`
 * falls back to the default instead of 400ing a feed request, because the
 * parameter arrives from a URL a user can edit and a broken page is a worse
 * answer than an ignored parameter.
 *
 * The exception is `boolParam`, which distinguishes three states on purpose.
 */

/** A comma-separated list, trimmed, with empties dropped. */
export function csv(value: string | null): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

/** A positive integer, or undefined. Zero and negatives are not values here. */
export function intParam(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.floor(parsed)
}

/**
 * A tri-state boolean: true, false, or "not asked".
 *
 * The distinction is load-bearing wherever a filter is optional.
 * `verifyYourself=false` means "only the confident cards", which is a
 * different request from omitting it, which means "all cards". A truthiness
 * check would collapse the two and silently drop half the feed.
 */
export function boolParam(value: string | null): boolean | undefined {
  if (value === null) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true
  if (normalized === "false" || normalized === "0" || normalized === "no") return false
  return undefined
}

/**
 * An ISO 8601 date or date-time, or undefined.
 *
 * A bare `2026-01-15` is parsed as UTC midnight by Date, which is what a date
 * range filter wants and is worth knowing when a boundary row looks missing.
 */
export function dateParam(value: string | null): Date | undefined {
  if (!value || !value.trim()) return undefined
  const parsed = new Date(value.trim())
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value)
}
