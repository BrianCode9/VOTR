import { sql } from "drizzle-orm"
import { db } from "@/db"
import { candidates } from "@/db/schema"
import type { NormalizedDocument } from "../adapters/types"
import type { IssueTag, PriorStance } from "../schemas/insight"

/**
 * Prior stance history, the context that makes stance-change detection honest.
 *
 * A model asked "has this person changed position?" with no records in front
 * of it will answer from memory, and what it produces is a plausible history
 * rather than one this system can show a receipt for. So the only history it
 * ever sees is rows that already passed quote verification, loaded here.
 *
 * The quote is read by slicing the stored document in SQL rather than by
 * selecting raw_text and slicing in Node: a prior-stance lookup should not pull
 * six full articles across the wire to show six sentences.
 */

export interface PriorStanceQuery {
  /** Speaker names to look up, as they appear on candidate rows. */
  names: string[]
  /** Never compare a document against itself. */
  excludeDocumentId?: string
  /** Cap per (speaker, topic) pair, newest first. */
  perTopic?: number
  /** Overall cap, so one prolific candidate cannot fill the prompt. */
  limit?: number
}

interface PriorStanceRow {
  // drizzle's execute<T> requires an index signature on the row shape.
  [column: string]: unknown

  id: string
  topic: string
  candidate_name: string
  position_text: string
  quote: string
  source_name: string
  published_at: string | Date | null
}

export async function loadPriorStances(
  query: PriorStanceQuery,
): Promise<PriorStance[]> {
  const { names, excludeDocumentId, perTopic = 2, limit = 12 } = query
  if (names.length === 0) return []

  const rows = await db.execute<PriorStanceRow>(sql`
    with history as (
      select
        i.id,
        i.issue_tag as topic,
        c.name as candidate_name,
        i.position_text,
        substring(d.raw_text from i.quote_char_start + 1
                  for i.quote_char_end - i.quote_char_start) as quote,
        d.source_name,
        d.published_at,
        row_number() over (
          partition by i.candidate_id, i.issue_tag
          order by d.published_at desc nulls last, i.created_at desc
        ) as rn
      from insights i
      join candidates c on c.id = i.candidate_id
      join documents d on d.id = i.document_id
      where i.status = 'published'
        and i.card_type in ('stance', 'stance_change')
        and c.name in ${sql.raw(valuesList(names))}
        ${excludeDocumentId ? sql`and i.document_id <> ${excludeDocumentId}` : sql``}
    )
    select id, topic, candidate_name, position_text, quote, source_name, published_at
    from history
    where rn <= ${perTopic}
    order by published_at desc nulls last
    limit ${limit}
  `)

  return [...rows].map((row) => ({
    id: row.id,
    topic: row.topic as IssueTag,
    candidateName: row.candidate_name,
    positionSummary: row.position_text,
    quote: row.quote,
    sourceName: row.source_name,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
  }))
}

/**
 * Names are interpolated as a literal list rather than bound parameters.
 *
 * drizzle's `inArray` would be the obvious choice, but this query is raw SQL
 * for the window function, and mixing a parameter array into `sql.raw` is how
 * injection happens. Each name is escaped by doubling its quotes, which is the
 * only escape a Postgres string literal needs.
 */
function valuesList(names: string[]): string {
  const escaped = names.map((n) => `'${n.replace(/'/g, "''")}'`)
  return `(${escaped.join(", ")})`
}

/**
 * Which known candidates this document actually talks about.
 *
 * Extraction has not run yet at this point, so the speakers are unknown. Rather
 * than a wasted first LLM pass to find out, the candidates already on the
 * ballot are matched against the document text. A document about nobody we
 * track gets no prior stances, which is correct: there is no history to
 * compare it to.
 */
export async function speakersInDocument(
  doc: NormalizedDocument,
): Promise<string[]> {
  const known = await db.select({ name: candidates.name }).from(candidates)
  if (known.length === 0) return []

  const haystack = doc.rawText.toLowerCase()
  return known
    .map((c) => c.name)
    .filter((name) => name.trim().length > 2 && haystack.includes(name.toLowerCase()))
}

/** The convenience path the pipeline uses: speakers, then their history. */
export async function loadPriorStancesForDocument(
  doc: NormalizedDocument,
): Promise<{ speakers: string[]; priorStances: PriorStance[] }> {
  const speakers = await speakersInDocument(doc)
  if (speakers.length === 0) return { speakers: [], priorStances: [] }

  const priorStances = await loadPriorStances({
    names: speakers,
    excludeDocumentId: doc.id,
  })

  return { speakers, priorStances }
}
