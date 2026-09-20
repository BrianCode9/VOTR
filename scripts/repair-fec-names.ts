/**
 * npm run data:repair-names             Report what would change.
 * npm run data:repair-names -- --apply  Rewrite the stored names transactionally.
 *
 * `npm run data:import` inserts with `on conflict do nothing`, so re-preparing
 * the snapshot after the FEC name-parsing fix does not touch rows that are
 * already in the table. This script carries that one fix into the database and
 * nothing else: it rewrites `candidates.name` where the snapshot and the table
 * disagree, and repairs the `speakers` rows those candidates resolved to.
 *
 * It also refreshes `candidate_sources.source_record`, so that the name a filer
 * actually submitted stays readable next to the name now published: `filedName`
 * on every FEC row, and `droppedNameTokens` where a title was removed.
 *
 * The speaker repair is the reason this is not a single UPDATE. Identity there
 * is `normalized_name`, and `normalizeSpeakerName` strips a suffix only from the
 * end of a name, so "GEORGE J JR KELLY" and "GEORGE J KELLY JR" are two
 * different people to it. Correcting the spelling therefore moves the identity
 * key, and where the corrected key already belongs to another row the two rows
 * were always one person -- "BRYAN LAMONT SGT. ARRINGTON" and "BRYAN LAMONT
 * ARRINGTON" -- so they are merged rather than left as a duplicate pair.
 */
import { writeFileSync } from "node:fs"
import postgres from "postgres"
import { aliasSet, normalizeSpeakerName } from "../lib/speakers/normalize"
import { loadSnapshot, candidateId, type CandidateRecord } from "./import-candidates"

type SpeakerRow = { id: string; name: string; normalized_name: string; normalized_aliases: string[] }

/**
 * Group every speaker that will end up under one identity key.
 *
 * Two affected rows can correct to the same key, and a corrected key can
 * already belong to an untouched row, so the survivor is chosen once per key:
 * an existing row that already holds the key if there is one, because its
 * insights and aliases are the ones worth keeping.
 */
export function planSpeakers(
  affected: { speaker: SpeakerRow; correctedName: string }[],
  byNormalized: Map<string, SpeakerRow>,
) {
  const groups = new Map<string, { survivor: SpeakerRow; name: string; merge: SpeakerRow[] }>()
  for (const { speaker, correctedName } of affected) {
    const key = normalizeSpeakerName(correctedName)
    if (!key) continue
    const existing = groups.get(key)
    if (existing) {
      if (existing.survivor.id !== speaker.id && !existing.merge.some((s) => s.id === speaker.id)) {
        existing.merge.push(speaker)
      }
      continue
    }
    const holder = byNormalized.get(key)
    const survivor = holder ?? speaker
    groups.set(key, {
      survivor,
      name: correctedName,
      merge: holder && holder.id !== speaker.id ? [speaker] : [],
    })
  }
  return groups
}

async function main() {
  const snapshot = loadSnapshot()
  const fec = new Map<string, CandidateRecord>()
  for (const c of snapshot.candidates) if (c.sourceKey.startsWith("fec:")) fec.set(candidateId(c), c)

  try { process.loadEnvFile(".env.local") } catch {}
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing")
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 20 })

  try {
    const rows = await sql<{ id: string; name: string; speaker_id: string | null }[]>`
      select id, name, speaker_id from candidates where id = any(${[...fec.keys()]}::uuid[])`
    const stale = rows.filter((r) => fec.get(r.id)!.name !== r.name)

    const speakers = await sql<SpeakerRow[]>`select id, name, normalized_name, normalized_aliases from speakers`
    const byId = new Map(speakers.map((s) => [s.id, s]))
    const byNormalized = new Map(speakers.map((s) => [s.normalized_name, s]))

    const affected: { speaker: SpeakerRow; correctedName: string }[] = []
    const seen = new Set<string>()
    for (const r of stale) {
      const speaker = r.speaker_id ? byId.get(r.speaker_id) : undefined
      if (!speaker || seen.has(speaker.id)) continue
      seen.add(speaker.id)
      affected.push({ speaker, correctedName: fec.get(r.id)!.name })
    }
    const groups = planSpeakers(affected, byNormalized)
    const merges = [...groups.values()].filter((g) => g.merge.length > 0)

    // The source record gains `filedName` for every FEC row, not only renamed
    // ones, so a reader can always compare the published name to the filing.
    const sources = await sql<{ candidate_id: string; source_record: Record<string, unknown> }[]>`
      select candidate_id, source_record from candidate_sources
       where candidate_id = any(${[...fec.keys()]}::uuid[])`
    const staleSources = sources.filter((s) => {
      const want = fec.get(s.candidate_id)!.sourceRecord
      return JSON.stringify(s.source_record.filedName ?? null) !== JSON.stringify(want.filedName ?? null)
        || JSON.stringify(s.source_record.droppedNameTokens ?? null) !== JSON.stringify(want.droppedNameTokens ?? null)
    })

    const report = {
      preparedAt: snapshot.preparedAt,
      fecCandidates: fec.size,
      candidateNamesRewritten: stale.length,
      sourceRecordsRefreshed: staleSources.length,
      speakersRepaired: groups.size,
      speakersMerged: merges.reduce((n, g) => n + g.merge.length, 0),
      applied: false,
      merges: merges.flatMap((g) => g.merge.map((m) => ({ from: m.name, into: g.survivor.name, as: g.name }))),
      examples: stale.slice(0, 10).map((r) => ({ from: r.name, to: fec.get(r.id)!.name })),
    }

    if (process.argv.includes("--apply")) {
      await sql.begin(async (tx) => {
        await tx.unsafe("select pg_advisory_xact_lock(20862026)")
        for (const r of stale) {
          await tx`update candidates set name = ${fec.get(r.id)!.name} where id = ${r.id}::uuid`
        }
        for (const s of staleSources) {
          const want = fec.get(s.candidate_id)!.sourceRecord
          // Only the two name keys are written; the bulk-source provenance the
          // importer added is left exactly as it is.
          const patch: Record<string, unknown> = { filedName: want.filedName ?? null }
          if (want.droppedNameTokens) patch.droppedNameTokens = want.droppedNameTokens
          await tx`
            update candidate_sources
               set source_record = source_record || ${sql.json(patch)}::jsonb
             where candidate_id = ${s.candidate_id}::uuid`
        }
        for (const group of groups.values()) {
          for (const dupe of group.merge) {
            await tx`update candidates set speaker_id = ${group.survivor.id}::uuid where speaker_id = ${dupe.id}::uuid`
            await tx`update insights set speaker_id = ${group.survivor.id}::uuid where speaker_id = ${dupe.id}::uuid`
            await tx`delete from speakers where id = ${dupe.id}::uuid`
          }
          // The corrected spelling leads the alias list; the spellings already on
          // the row are kept behind it so no existing match is dropped.
          const aliases = aliasSet([
            group.name,
            ...group.merge.flatMap((d) => d.normalized_aliases),
            ...group.survivor.normalized_aliases,
          ])
          await tx`
            update speakers
               set name = ${group.name},
                   normalized_name = ${normalizeSpeakerName(group.name)},
                   normalized_aliases = ${aliases},
                   updated_at = now()
             where id = ${group.survivor.id}::uuid`
        }
      })
      report.applied = true
    }

    writeFileSync("data/candidates/name-repair-report.json", JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ ...report, merges: report.merges.length, examples: undefined }, null, 2))
    console.log(report.applied ? "Applied." : "Dry run. Re-run with --apply to write.")
  } finally {
    await sql.end()
  }
}

main()
