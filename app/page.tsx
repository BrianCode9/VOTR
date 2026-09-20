import { SiteNav } from "@/components/landing/site-nav"
import { SiteFooter } from "@/components/landing/site-footer"
import { Hero } from "@/components/landing/hero"
import { UpcomingElections } from "@/components/landing/upcoming-elections"
import { FeaturedCandidates } from "@/components/landing/featured-candidates"
import { FederalCandidates } from "@/components/landing/federal-candidates"
import { LocalCandidates } from "@/components/landing/local-candidates"
import { startHref } from "@/components/ballot/start-link"
import { readLocation } from "@/lib/location/cookie"
import { getStatesWithBallots } from "@/lib/queries/ballot"

/**
 * The entry point, and now the only question the site asks: where do you vote?
 *
 * Everything below the hero is context for that question rather than an
 * alternative to it. The page used to be ten marketing bands whose sixteen
 * calls to action all pointed at each other; every one of them now leads to
 * the ballot, either directly or through the form at `#start`.
 *
 * Dynamic rather than revalidated, because the page reads the saved location
 * to decide whether to greet a returning reader with their ballot. That is
 * worth more than an hour of edge cache on a page that is one form.
 */
export const dynamic = "force-dynamic"

export default async function LandingPage({ searchParams }: PageProps<"/">) {
  const [states, location, href, query] = await Promise.all([
    getStatesWithBallots(),
    readLocation(),
    startHref(),
    searchParams,
  ])

  const available = states.map((state) => state.state)

  return (
    <div className="flex min-h-dvh flex-col bg-sheet">
      <a
        href="#main"
        className="sr-only rounded-full bg-navy px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[100]"
      >
        Skip to content
      </a>

      <SiteNav startHref={href} />

      <main id="main" className="flex-1">
        <Hero
          availableStates={available}
          savedState={location?.state}
          unresolved={query.unresolved === "1"}
        />
        <UpcomingElections />
        <FeaturedCandidates />
        <FederalCandidates />
        <LocalCandidates />
      </main>

      <SiteFooter />
    </div>
  )
}
