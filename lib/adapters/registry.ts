import type { AdapterRun, NormalizedDocument, SourceType } from "./types"

/**
 * The adapter contract and the registry the pipeline resolves against.
 *
 * The pipeline never imports a concrete adapter. It asks the registry for
 * adapters by id, calls fetch(since), and stores what comes back. Adding a
 * source is therefore a new file plus one register() call, and touches no
 * pipeline code. That is the whole point of this module.
 */

export interface SourceAdapter {
  /** Stable, unique, used on the command line and in logs. */
  readonly id: string
  /** Human label for the run report. */
  readonly label: string
  /** Lands in documents.source_type. */
  readonly sourceType: SourceType

  /**
   * Pull everything published since `since`, or everything available when
   * `since` is null.
   *
   * Must not throw. A source that is entirely down returns an empty document
   * list and one failure entry; a source where three of fifty pages fail
   * returns forty-seven documents and three failures.
   */
  fetch(since: Date | null): Promise<AdapterRun>
}

export class AdapterRegistry {
  private readonly adapters = new Map<string, SourceAdapter>()

  register(adapter: SourceAdapter): this {
    if (this.adapters.has(adapter.id)) {
      // Two adapters under one id means one of them silently never runs.
      throw new Error(`adapter id "${adapter.id}" is already registered`)
    }
    this.adapters.set(adapter.id, adapter)
    return this
  }

  get(id: string): SourceAdapter | undefined {
    return this.adapters.get(id)
  }

  has(id: string): boolean {
    return this.adapters.has(id)
  }

  ids(): string[] {
    return [...this.adapters.keys()]
  }

  all(): SourceAdapter[] {
    return [...this.adapters.values()]
  }

  /**
   * Run several adapters and merge their output.
   *
   * Runs sequentially rather than in parallel: every adapter is doing dozens
   * of outbound article fetches of its own, and stacking those bursts is how
   * you get rate limited by a publisher.
   */
  async fetchAll(
    since: Date | null,
    ids: string[] = this.ids(),
  ): Promise<AdapterRun & { byAdapter: Record<string, number> }> {
    const documents: NormalizedDocument[] = []
    const failures: AdapterRun["failures"] = []
    const byAdapter: Record<string, number> = {}

    for (const id of ids) {
      const adapter = this.adapters.get(id)
      if (!adapter) {
        failures.push({ url: id, reason: `no adapter registered as "${id}"` })
        continue
      }

      // An adapter that throws anyway is a bug in that adapter, not a reason
      // to lose the documents the previous adapters already produced.
      let run: AdapterRun
      try {
        run = await adapter.fetch(since)
      } catch (e) {
        failures.push({
          url: adapter.id,
          reason: `adapter threw: ${e instanceof Error ? e.message : String(e)}`,
        })
        byAdapter[id] = 0
        continue
      }

      documents.push(...run.documents)
      failures.push(...run.failures)
      byAdapter[id] = run.documents.length
    }

    return { documents: dedupeByUrl(documents), failures, byAdapter }
  }
}

/**
 * Two adapters can legitimately surface the same article (a GDELT hit that is
 * also in a configured RSS feed). First one wins; the id is derived from the
 * URL so the duplicate would collide on insert anyway.
 */
export function dedupeByUrl(documents: NormalizedDocument[]): NormalizedDocument[] {
  const seen = new Set<string>()
  const out: NormalizedDocument[] = []
  for (const doc of documents) {
    if (seen.has(doc.id)) continue
    seen.add(doc.id)
    out.push(doc)
  }
  return out
}

/** The process-wide registry. Populated by lib/adapters/index.ts. */
export const registry = new AdapterRegistry()
