import { getFeed } from "@/lib/queries/feed"
import { InsightCard } from "@/components/insight-card"

// Reads the database on every request. The feed is finite and small; there is
// nothing here worth caching yet.
export const dynamic = "force-dynamic"

export default async function FeedPage() {
  const items = await getFeed()

  if (items.length === 0) {
    return (
      <main className="min-h-dvh bg-ink flex items-center justify-center px-6">
        <div className="max-w-md space-y-3">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Nothing in the feed</h1>
          <p className="text-text-lo">
            No verified insights are stored yet. Run{" "}
            <code className="font-mono text-mark">npm run ingest</code> to pull documents,
            then <code className="font-mono text-mark">npm run persist</code> to extract
            and verify quotes from them.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="h-dvh overflow-y-scroll snap-y snap-mandatory bg-ink">
      {items.map((item) => (
        <InsightCard key={item.id} item={item} />
      ))}

      <section className="snap-start h-dvh flex flex-col items-center justify-center gap-4 bg-ink px-6 text-center">
        <p className="font-mono text-[11px] uppercase tracking-wider text-text-lo">
          End of run
        </p>
        <h2 className="text-2xl font-semibold tracking-[-0.02em] max-w-sm">
          That is every verified position we have on this ballot.
        </h2>
        <p className="text-text-lo max-w-sm">
          The feed is finite on purpose. There is no more to scroll.
        </p>
      </section>
    </main>
  )
}
