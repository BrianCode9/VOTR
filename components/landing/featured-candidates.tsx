import Image from "next/image"
import Link from "next/link"
import { Section } from "@/components/landing/section"
import { getFeaturedCandidates } from "@/lib/landing/queries"

/**
 * Featured candidates.
 *
 * Portrait-led, unlike the other candidate rows, because faces are the reason
 * this row exists. Every candidate here has a real licensed photo — the query
 * inner-joins candidate_photos — so there is no initials fallback to design
 * around.
 *
 * Identical cards, no badges, no scores. See getFeaturedCandidates for why the
 * order is what it is.
 */
export async function FeaturedCandidates() {
  const candidates = await getFeaturedCandidates(8)
  if (candidates.length === 0) return null

  return (
    <Section id="featured">
      <h2 className="font-heading text-2xl font-semibold tracking-[-0.03em] text-navy">
        Candidates
      </h2>

      <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <Link
              href={`/candidate/${candidate.id}`}
              className="group block overflow-hidden rounded-card border border-hairline bg-sheet transition-colors duration-150 hover:border-brand/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <div className="relative aspect-[4/5] overflow-hidden bg-mist">
                <Image
                  src={candidate.photoUrl!}
                  alt={`Portrait of ${candidate.name}`}
                  fill
                  unoptimized
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  className="object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
                />
              </div>

              <div className="p-3.5">
                <h3 className="truncate font-heading text-base font-semibold tracking-[-0.02em] text-navy">
                  {candidate.name}
                </h3>
                <p className="mt-0.5 truncate text-sm text-slate-ink">
                  {candidate.office}
                </p>
                <p className="mt-1.5 truncate font-mono text-[10px] tracking-[-0.01em] text-slate-ink/80">
                  {candidate.party} · {candidate.jurisdiction}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  )
}
