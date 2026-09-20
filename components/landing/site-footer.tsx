import { VotrMark } from "@/components/brand/votr-logo"

/**
 * The footer, deliberately one line.
 *
 * It was three columns of links across a navy band, which read as another
 * content section rather than as the end of the page, and most of those
 * links pointed at anchors that no longer exist. A footer's job here is to
 * close the page and carry the one disclaimer that has to appear everywhere.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-hairline">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-5 py-5 sm:px-8">
        <VotrMark size={16} />
        <p className="font-mono text-[10px] tracking-[-0.01em] text-slate-ink/70">
          Votr informs; it never tells you who to vote for.
        </p>
        <p className="ml-auto font-mono text-[10px] tracking-[-0.01em] text-slate-ink/50">
          © {new Date().getFullYear()}
        </p>
      </div>
    </footer>
  )
}
