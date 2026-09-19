import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { documents } from "@/db/schema"
import type { MediaType, NormalizedDocument, SourceType } from "../adapters/types"

/**
 * Document storage.
 *
 * A stored document is immutable. Its raw_text is the coordinate space every
 * quote offset in the database is measured against, so a URL we already have
 * is skipped rather than updated: rewriting raw_text in place would silently
 * repoint every insight on that document at the wrong characters. A publisher
 * who edits their page gets a new row, not an edit.
 */

type DocumentRow = typeof documents.$inferSelect

export interface StoreResult {
  stored: { id: string; title: string }[]
  skipped: number
}

export async function storeDocuments(
  docs: NormalizedDocument[],
): Promise<StoreResult> {
  if (docs.length === 0) return { stored: [], skipped: 0 }

  const rows = docs.map((d) => ({
    // The id is a pure function of the URL, so re-ingesting the same page
    // produces the same row rather than a second copy of it.
    id: d.id,
    url: d.sourceUrl,
    sourceType: d.sourceType,
    sourceName: d.sourceName,
    title: d.title,
    publishedAt: d.publishedAt,
    fetchedAt: d.fetchedAt,
    rawText: d.rawText,
    mediaType: d.mediaType,
    durationSeconds: d.durationSeconds ?? null,
    isSynthetic: d.isSynthetic,
    submittedByUser: d.submittedByUser ?? null,
    rawMetadata: d.rawMetadata,
  }))

  const stored = await db
    .insert(documents)
    .values(rows)
    .onConflictDoNothing({ target: documents.url })
    .returning({ id: documents.id, title: documents.title })

  return { stored, skipped: rows.length - stored.length }
}

/**
 * Rehydrate the adapter shape from a stored row.
 *
 * Verification and the prompt both take a NormalizedDocument, so a document
 * read back out of the database has to be indistinguishable from one that just
 * came off an adapter. Anything that diverges here diverges in the offsets.
 */
export function toNormalized(row: DocumentRow): NormalizedDocument {
  return {
    id: row.id,
    sourceUrl: row.url,
    sourceType: row.sourceType as SourceType,
    sourceName: row.sourceName,
    title: row.title,
    publishedAt: row.publishedAt,
    fetchedAt: row.fetchedAt,
    rawText: row.rawText,
    mediaType: row.mediaType as MediaType,
    durationSeconds: row.durationSeconds ?? undefined,
    isSynthetic: row.isSynthetic,
    submittedByUser: row.submittedByUser ?? undefined,
    rawMetadata: (row.rawMetadata ?? {}) as Record<string, unknown>,
  }
}

export async function loadDocument(id: string): Promise<NormalizedDocument | null> {
  const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1)
  return row ? toNormalized(row) : null
}

export async function loadDocuments(ids: string[]): Promise<NormalizedDocument[]> {
  if (ids.length === 0) return []
  const rows = await db.select().from(documents).where(inArray(documents.id, ids))
  return rows.map(toNormalized)
}
