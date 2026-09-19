import { hasDatabase } from "@/db"
import { getFeed } from "@/lib/queries/feed"
import { InsightCard } from "@/components/insight-card"

// Reads the database on every request. The feed is finite and small; there is
// nothing here worth caching yet.
export const dynamic = "force-dynamic"

export default async function FeedPage() {
  const items = await getFeed()

  if (items.length === 0) {
    return (
      <main className="min-h-dvh bg-ink flex items-center justify-center px-6 py-12">
        <div className="max-w-lg space-y-4">
          <p className="font-mono text-[11px] uppercase tracking-wider text-text-lo">
            {hasDatabase ? "Feed is empty" : "No database connection"}
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            {hasDatabase
              ? "Nothing has been ingested yet."
              : "You are not connected to the database."}
          </h1>

          {hasDatabase ? (
            <p className="text-text-lo leading-relaxed">
              Pull some documents, then extract and verify quotes from them:
            </p>
          ) : (
            <p className="text-text-lo leading-relaxed">
              The interface runs without it, so you can build and style against this
              page. To load real data, run setup. If it reports that the env pull
              failed, you are not in the Neon org yet and need an invite.
            </p>
          )}

          <pre className="font-mono text-[12px] leading-relaxed bg-ink-raised text-text-hi p-4 overflow-x-auto">
            {hasDatabase
              ? "npm run ingest\nnpm run persist"
              : "npm run setup"}
          </pre>

          <p className="font-mono text-[11px] text-text-lo">
            See README.md for the full setup, or AGENTS.md if you are an agent.
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
