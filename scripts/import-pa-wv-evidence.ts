/** Import reviewed evidence only. Dry-run by default; --apply commits atomically. */
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import postgres from "postgres"
import { z } from "zod"
import { candidateId, loadSnapshot, stableId } from "./import-candidates"
import { evidenceSchema, validateEvidence } from "../lib/ingest/candidate-evidence"

type Page = { sourceKey: string; name: string; state: string; url: string; seedUrl: string; kind: string; title: string; rawText: string; fetchedAt: string }
const parse = (path: string) => JSON.parse(readFileSync(path, "utf8"))
async function main() {
  const pages = parse("data/candidates/raw/pa-wv/documents.json") as Page[]
  const ledger = z.array(evidenceSchema).parse(parse("data/candidates/pa-wv-evidence.json"))
  const snapshot = loadSnapshot()
  const seen = new Set<string>()
  const verified = ledger.map(entry => {
    const c = snapshot.candidates.find(c => c.sourceKey === entry.sourceKey)
    if (!c || !["PA", "WV"].includes(c.state)) throw new Error("Unknown or out-of-scope candidate")
    const page = pages.find(p => p.url === entry.url && p.sourceKey === entry.sourceKey)
    if (!page) throw new Error("Missing source snapshot: " + entry.url)
    const key = entry.sourceKey + entry.url
    if (seen.has(key)) throw new Error("Duplicate source in review ledger")
    seen.add(key)
    if (entry.claims.length === 0 && !entry.biography) throw new Error("Empty reviewed entry")
    try {
      return { ...validateEvidence(entry, page), page, candidate: c, candidateId: candidateId(c) }
    } catch (e) { throw new Error(entry.url + ": " + (e as Error).message) }
  })
  const report = { applied: false, reviewedPages: verified.length, candidates: new Set(verified.map(v => v.candidateId)).size, claimsValidated: verified.reduce((n, v) => n + v.claims.length, 0), documentsInserted: 0, insightsInserted: 0, profilesUpdated: 0, byState: {} as Record<string, { candidates: number; claims: number }> }
  for (const state of ["PA", "WV"]) {
    const rows = verified.filter(v => v.candidate.state === state)
    report.byState[state] = { candidates: new Set(rows.map(v => v.candidateId)).size, claims: rows.reduce((n, v) => n + v.claims.length, 0) }
  }
  console.log("Validated", report)
  if (!process.argv.includes("--apply")) return
  process.loadEnvFile(".env.local")
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing")
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 20 })
  try {
    await sql.begin(async tx => {
      await tx.unsafe("select pg_advisory_xact_lock(20862026)")
      for (const v of verified) {
        const [identity] = await tx.unsafe("select candidate_id from candidate_sources where source_key=$1", [v.sourceKey])
        if (identity?.candidate_id !== v.candidateId) throw new Error("Database identity mismatch")
        const hash = createHash("sha256").update(v.rawText).digest("hex")
        // Always version this ingestion's immutable coordinate space, including Unicode normalization.
        const url = v.url.split("#")[0] + "#votr-content-" + hash.slice(0, 16)
        const id = stableId("document:" + url + ":" + hash)
        const name = (v.page.kind === "official_office" ? "Official office: " : "Campaign website: ") + v.page.name
        const inserted = await tx.unsafe("insert into documents (id,url,source_type,source_name,title,raw_text,fetched_at,media_type,is_synthetic,raw_metadata) values ($1,$2,$3,$4,$5,$6,$7,'article',false,$8::jsonb) on conflict (url) do nothing returning id", [id, url, v.page.kind, name, v.page.title, v.rawText, v.page.fetchedAt, { originalUrl: v.url, originalTextSha256: v.sha256, ingestion: "pa-wv-reviewed-2026-09", sourceKey: v.sourceKey, normalization: "htmlToText; non-BMP replaced before assigning offsets" }])
        report.documentsInserted += inserted.length
        const [stored] = await tx.unsafe("select id,raw_text from documents where url=$1", [url])
        if (stored.raw_text !== v.rawText) throw new Error("Immutable source mismatch")
        for (const claim of v.claims) {
          if (stored.raw_text.slice(claim.start, claim.end) !== claim.quote) throw new Error("Stored quote mismatch")
          const insightId = stableId("insight:" + v.candidateId + ":" + v.url + ":" + claim.issueTag + ":" + claim.quote)
          const result = await tx.unsafe("insert into insights (id,document_id,candidate_id,issue_tag,position_text,plain_language,quote_char_start,quote_char_end,quote_verified,attribution,status,payload) values ($1,$2,$3,$4,$5,$5,$6,$7,'exact','characterization','published',$8::jsonb) on conflict (id) do nothing returning id", [insightId, stored.id, v.candidateId, claim.issueTag, claim.positionText, claim.start, claim.end, JSON.stringify({ reviewMethod: "source-and-summary editorial review; exact-span validation", sourceKind: v.page.kind })])
          report.insightsInserted += result.length
        }
        const metadata: Record<string, unknown> = {}
        if (v.biography) metadata.votrBackground = { text: v.biography.text, sourceUrl: v.url, sourceKind: v.page.kind, documentId: stored.id, quote: v.biography.quote, fetchedAt: v.page.fetchedAt }
        const updated = await tx.unsafe("update candidate_sources set source_record=source_record || $1::jsonb || jsonb_build_object('policyDocumentIds', (select coalesce(jsonb_agg(distinct x),'[]'::jsonb) from jsonb_array_elements(coalesce(source_record->'policyDocumentIds','[]'::jsonb) || jsonb_build_array($2::text)) x)), campaign_website=coalesce(campaign_website,$3) where source_key=$4 returning source_key", [metadata, stored.id, v.page.kind === "campaign" ? v.page.seedUrl : null, v.sourceKey])
        report.profilesUpdated += updated.length
      }
    })
    report.applied = true
    writeFileSync("data/candidates/pa-wv-import-report.json", JSON.stringify(report, null, 2) + "\n")
    console.log("COMMITTED", report)
  } finally { await sql.end() }
}
main().catch(e => { console.error("Import failed:", e.message?.replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]")); process.exitCode = 1 })
