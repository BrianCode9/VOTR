import Link from "next/link"
import { Container } from "@/components/landing/section"
import { VotrLogo } from "@/components/brand/votr-logo"

/**
 * Every href here is absolute.
 *
 * The footer renders on the ballot, candidate and topic pages as well as the
 * landing page, and a bare "#policy" on a candidate page is a link that goes
 * nowhere. Two entries that used to point at the same duplicate anchor are
 * gone rather than relabelled.
 */
const COLUMNS = [
  {
    heading: "Explore",
    links: [
      { label: "Trending issues", href: "/#trending" },
      { label: "Policy areas", href: "/#policy" },
      { label: "Federal races", href: "/#federal" },
      { label: "Local races", href: "/#local" },
    ],
  },
  {
    heading: "Your ballot",
    links: [
      { label: "Find your ballot", href: "/#start" },
      { label: "Upcoming elections", href: "/#ballot" },
      { label: "Every verified quote", href: "/feed" },
    ],
  },
  {
    heading: "About",
    links: [
      { label: "How Votr works", href: "/#parties" },
      { label: "Where the parties stand", href: "/#parties" },
    ],
  },
] as const

export function SiteFooter() {
  return (
    <footer className="border-t border-navy-line bg-navy text-white">
      <Container className="py-14 sm:py-16">
        <div className="grid gap-10 md:grid-cols-[1.4fr_2fr]">
          <div>
            <VotrLogo tone="light" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/55">
              Political information for people who want to decide for
              themselves. Here is the information — you decide.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((column) => (
              <div key={column.heading}>
                <h3 className="font-mono text-[10px] tracking-[-0.01em] text-white/55">
                  {column.heading}
                </h3>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {link.href.startsWith("/") ? (
                        <Link
                          href={link.href}
                          className="rounded text-sm text-white/70 transition-colors hover:text-brand-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright"
                        >
                          {link.label}
                        </Link>
                      ) : (
                        <a
                          href={link.href}
                          className="rounded text-sm text-white/70 transition-colors hover:text-brand-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright"
                        >
                          {link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[11px] text-white/55">
            © {new Date().getFullYear()} Votr. Nonpartisan by design.
          </p>
          <p className="font-mono text-[11px] text-white/55">
            No endorsements. No candidate rankings. No scores.
          </p>
        </div>
      </Container>
    </footer>
  )
}
