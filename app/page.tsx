import { SiteNav } from "@/components/landing/site-nav"
import { Hero } from "@/components/landing/hero"
import { UpcomingElections } from "@/components/landing/upcoming-elections"
import { PartyBeliefs } from "@/components/landing/party-beliefs"
import { TrendingTopics } from "@/components/landing/trending-topics"
import { FederalCandidates } from "@/components/landing/federal-candidates"
import { LocalCandidates } from "@/components/landing/local-candidates"
import { PolicyExplorer } from "@/components/landing/policy-explorer"
import { ForMe } from "@/components/landing/for-me"
import { getIssues } from "@/lib/landing/queries"
import { FinalCta } from "@/components/landing/final-cta"
import { SiteFooter } from "@/components/landing/site-footer"

/**
 * The landing page is fully static apart from the election countdown, which
 * only needs to be right to the day. An hour of staleness is fine and keeps
 * the page a cached document rather than a render per visitor.
 */
export const revalidate = 3600

export default async function LandingPage() {
  const issues = await getIssues()

  return (
    <div className="flex min-h-dvh flex-col bg-sheet">
      <a
        href="#main"
        className="sr-only rounded-full bg-navy px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[100]"
      >
        Skip to content
      </a>

      <SiteNav />

      <main id="main" className="flex-1">
        <Hero />
        <UpcomingElections />
        <PartyBeliefs />
        <TrendingTopics />
        <FederalCandidates />
        <LocalCandidates />
        <PolicyExplorer />
        <ForMe issues={issues} />
        <FinalCta />
      </main>

      <SiteFooter />
    </div>
  )
}
