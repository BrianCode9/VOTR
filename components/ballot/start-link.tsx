import Link from "next/link"
import { ballotPath, readLocation } from "@/lib/location/cookie"

/**
 * The one call to action on the marketing surfaces.
 *
 * Before this existed every button on the landing page pointed at another
 * section of the landing page, so the site had sixteen calls to action and no
 * destinations. There is now exactly one thing to ask a reader to do, and this
 * component is how every surface asks it:
 *
 * - a reader who has already told us where they vote goes straight to their
 *   ballot;
 * - a reader who has not goes to the form that asks, wherever they are.
 *
 * Which means no CTA anywhere can become a dead end again without this file
 * changing.
 */
export async function StartLink({
  children,
  className,
  /** Used only when no location is saved and we are already on the landing page. */
  anchor = "/#start",
}: {
  children: React.ReactNode
  className?: string
  anchor?: string
}) {
  const location = await readLocation()
  const href = location ? ballotPath(location) : anchor

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}

/** The href on its own, for callers that render their own element. */
export async function startHref(anchor = "/#start"): Promise<string> {
  const location = await readLocation()
  return location ? ballotPath(location) : anchor
}
