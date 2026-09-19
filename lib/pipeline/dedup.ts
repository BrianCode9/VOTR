import type { CardType, VerifiedItem } from "../schemas/insight"
import { relevanceScore } from "./relevance"

/**
 * Dedup at write time.
 *
 * Two different jobs, split between here and the feed query:
 *
 * - Here: two items of the SAME kind resting on the same evidence are the same
 *   insight said twice. One of them is kept and the other never becomes a row.
 * - In the feed query: items of DIFFERENT kinds on the same quote are genuinely
 *   different insights, so they are all stored, and the feed shows one of them
 *   with the rest attached. See lib/queries/feed.ts.
 *
 * Doing the first job here rather than in the feed means the duplicate never
 * costs a row, an id, or a judge call.
 */

export interface DroppedItem {
  item: VerifiedItem
  reason: string
}

export interface DedupResult {
  kept: VerifiedItem[]
  dropped: DroppedItem[]
}

/** Is `inner` entirely inside `outer`? */
function contains(outer: VerifiedItem, inner: VerifiedItem): boolean {
  return (
    outer.quoteCharStart <= inner.quoteCharStart && outer.quoteCharEnd >= inner.quoteCharEnd
  )
}

function span(item: VerifiedItem): string {
  return `${item.quoteCharStart}..${item.quoteCharEnd}`
}

/**
 * Collapse same-kind duplicates within one document's extraction.
 *
 * Two rules, in order:
 *
 * 1. Identical (card type, span) - the model returned the same item twice.
 *    Keep the better scoring one.
 * 2. Nested (card type, span) - one quote sits entirely inside another and
 *    they carry the same topic. Keep the longer span: it is the one that still
 *    makes sense read aloud on its own, which is what the card has to do.
 *
 * Note what is NOT collapsed: two items of the same kind on overlapping but
 * neither-contains-the-other spans, and two items on the same span with
 * different topics. Both are cases where the model found distinct things, and
 * merging them would lose one.
 */
export function dedupeVerified(items: VerifiedItem[]): DedupResult {
  const scored = items.map((item) => ({ item, score: relevanceScore(item) }))

  // Best first, so the survivor of any collision is decided by one rule rather
  // than by the order the model happened to emit its arrays in.
  scored.sort((a, b) => b.score - a.score || a.item.quoteCharStart - b.item.quoteCharStart)

  const kept: VerifiedItem[] = []
  const dropped: DroppedItem[] = []
  const seenSpans = new Set<string>()

  for (const { item } of scored) {
    const exactKey = `${item.cardType}:${span(item)}`
    if (seenSpans.has(exactKey)) {
      dropped.push({
        item,
        reason: `duplicate ${item.cardType} on the same quote span ${span(item)}`,
      })
      continue
    }

    const enclosing = kept.find(
      (other) =>
        other.cardType === item.cardType &&
        other.topic === item.topic &&
        contains(other, item),
    )
    if (enclosing) {
      dropped.push({
        item,
        reason:
          `${item.cardType} quote ${span(item)} sits inside the kept ` +
          `${span(enclosing)} on the same topic`,
      })
      continue
    }

    seenSpans.add(exactKey)
    kept.push(item)
  }

  // Restore document order. The feed sorts for itself, and reading a run log in
  // the order the document reads is worth more here than keeping score order.
  kept.sort((a, b) => a.quoteCharStart - b.quoteCharStart)

  return { kept, dropped }
}

/**
 * Feed-side collapsing, as a pure function over already-fetched rows.
 *
 * The feed query does this in SQL so that a page of N cards is N rows. This
 * exists for the same rule applied to a list already in memory, and as the
 * thing the SQL is tested against.
 */
export const CARD_PRIORITY: Record<CardType, number> = {
  stance_change: 0,
  voter_relevance: 1,
  stance: 2,
  factual_claim: 3,
}

export interface CollapsibleRow {
  id: string
  documentId: string
  quoteCharStart: number
  quoteCharEnd: number
  cardType: CardType
  relevanceScore: number
}

/**
 * Group rows that cite the same span of the same document, keeping the
 * highest-priority card of each group.
 *
 * Priority before score: a flip-flop and a stance on the same words should
 * surface as the flip-flop, which is the more informative framing of the same
 * evidence, regardless of which one scored marginally higher.
 */
export function collapseByQuote<T extends CollapsibleRow>(
  rows: T[],
): { row: T; collapsed: T[] }[] {
  const groups = new Map<string, T[]>()

  for (const row of rows) {
    const key = `${row.documentId}:${row.quoteCharStart}:${row.quoteCharEnd}`
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }

  const out: { row: T; collapsed: T[] }[] = []
  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (a, b) =>
        CARD_PRIORITY[a.cardType] - CARD_PRIORITY[b.cardType] ||
        b.relevanceScore - a.relevanceScore ||
        a.id.localeCompare(b.id),
    )
    out.push({ row: sorted[0], collapsed: sorted.slice(1) })
  }

  return out
}
