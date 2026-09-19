/**
 * npm run data:import             Validate only.
 * npm run data:import -- --apply  Insert the prepared snapshot transactionally.
 * No paid services, deletes, or overwrites of existing candidate/document rows.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import postgres from "postgres"
import { z } from "zod"

export function stableId(key: string): string {
 const h=createHash("sha256").update("votr-free-data-v1:"+key).digest("hex")
 return h.slice(0,8)+"-"+h.slice(8,12)+"-5"+h.slice(13,16)+"-a"+h.slice(17,20)+"-"+h.slice(20,32)
}
const candidateSchema=z.object({
 sourceKey:z.string().min(1),name:z.string().min(1),party:z.string().nullable(),
 state:z.string().regex(/^[A-Z]{2}$/),office:z.string().min(1),districtType:z.string().min(1),district:z.string().min(1),
 level:z.enum(["federal","state"]),electionStage:z.enum(["general","cycle"]),
 candidacyStatus:z.enum(["certified_general_candidate","official_general_candidate","general_write_in","fec_filing_not_ballot_verified"]),
 sourceName:z.string(),sourceUrl:z.string().url(),sourceRecord:z.record(z.string(),z.unknown()),
 incumbent:z.boolean(),incumbentKnown:z.boolean(),campaignWebsite:z.string().nullable(),biography:z.string().nullable(),
 electionDate:z.literal("2026-11-03T00:00:00Z")
})
export const snapshotSchema=z.object({
 year:z.literal(2026),preparedAt:z.string(),
 sources:z.array(z.object({url:z.string().url(),sha256:z.string().length(64),retrievedAt:z.string()})),
 candidates:z.array(candidateSchema).min(1),rejections:z.array(z.unknown())
})
export type CandidateRecord=z.infer<typeof candidateSchema>
export function loadSnapshot() {
 const data=snapshotSchema.parse(JSON.parse(readFileSync("data/candidates/candidates-2026.json","utf8")))
 if(new Set(data.candidates.map(c=>c.sourceKey)).size!==data.candidates.length) throw new Error("Duplicate source keys")
 for(const c of data.candidates) {
  if((c.electionStage==="cycle") !== (c.candidacyStatus==="fec_filing_not_ballot_verified")) throw new Error("Stage/status mismatch")
 }
 return data
}
export function candidateId(c: CandidateRecord) {return stableId("candidate:"+c.sourceKey)}
export async function main() {
 const snapshot=loadSnapshot()
 const districtRows=new Map<string,Record<string,unknown>>()
 const raceRows=new Map<string,Record<string,unknown>>()
 const candidateRows: Record<string,unknown>[]=[]
 const sourceRows: Record<string,unknown>[]=[]
 for(const c of snapshot.candidates) {
  const geoId="US-"+c.state+"-"+c.districtType+"-"+c.district
  const districtId=stableId("district:"+geoId)
  const raceId=stableId("race:"+geoId+":"+c.office+":"+c.electionStage+":2026")
  districtRows.set(districtId,{id:districtId,type:c.districtType,name:c.state+" "+c.office+(c.district==="statewide"?"":" District "+c.district),state:c.state,geo_id:geoId})
  raceRows.set(raceId,{id:raceId,district_id:districtId,office:c.office,election_date:c.electionDate,level:c.level})
  candidateRows.push({id:candidateId(c),race_id:raceId,name:c.name,party:c.party,incumbent:c.incumbent})
  const source=snapshot.sources.find(s=>c.sourceKey.startsWith("fec:")?s.url.includes("fec.gov"):c.sourceKey.startsWith("ca:")?s.url.includes("sos.ca.gov"):s.url.includes("maryland.gov"))!
  sourceRows.push({source_key:c.sourceKey,candidate_id:candidateId(c),election_stage:c.electionStage,candidacy_status:c.candidacyStatus,source_name:c.sourceName,source_url:c.sourceUrl,source_record:{...c.sourceRecord,bulkSourceUrl:source.url,sourceSha256:source.sha256},incumbent_known:c.incumbentKnown,campaign_website:c.campaignWebsite,biography:c.biography,fetched_at:source.retrievedAt})
 }
 const report={preparedAt:snapshot.preparedAt,candidates:candidateRows.length,races:raceRows.size,districts:districtRows.size,rejectedSourceRecords:snapshot.rejections.length,applied:false,inserted:{districts:0,races:0,candidates:0,sources:0}}
 console.log("Validated",report)
 if(!process.argv.includes("--apply")) return
 try{process.loadEnvFile(".env.local")}catch{}
 if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing")
 const sql=postgres(process.env.DATABASE_URL,{max:1,connect_timeout:20})
 try {
  await sql.begin(async tx=>{
   await tx.unsafe("select pg_advisory_xact_lock(20862026)")
   const existing=await tx.unsafe("select id,geo_id from districts")
   const ids=new Map(existing.map(d=>[d.geo_id,d.id]))
   for(const d of districtRows.values()) if(ids.has(d.geo_id)) {
    for(const r of raceRows.values()) if(r.district_id===d.id) r.district_id=ids.get(d.geo_id)
    d.id=ids.get(d.geo_id)
   }
   for(const [table,rows,key] of [
    ["districts",[...districtRows.values()],"districts"],
    ["races",[...raceRows.values()],"races"],
    ["candidates",candidateRows,"candidates"],
    ["candidate_sources",sourceRows,"sources"]
   ] as const) {
    // Table identifiers are a closed literal list; all record values are bound JSON.
    for(let i=0;i<rows.length;i+=200) {
     const inserted=await tx.unsafe("insert into "+table+" select * from jsonb_populate_recordset(null::"+table+", $1::text::jsonb) on conflict do nothing returning 1",[JSON.stringify(rows.slice(i,i+200))])
     report.inserted[key]+=inserted.length
    }
   }
   const sources=await tx.unsafe("select source_key,candidate_id from candidate_sources")
   const actual=new Map(sources.map(s=>[s.source_key,s.candidate_id]))
   if(snapshot.candidates.some(c=>actual.get(c.sourceKey)!==candidateId(c))) throw new Error("Post-import identity mismatch")
  })
  report.applied=true
  writeFileSync("data/candidates/import-report.json",JSON.stringify(report,null,2)+"\n")
  console.log("COMMITTED",report)
 } finally {await sql.end()}
}
if(process.argv[1]?.replaceAll("\\","/").endsWith("/import-candidates.ts")) main().catch(e=>{console.error("Import failed:",e.code??e.name,e.message?.replace(/postgres(?:ql)?:\/\/\S+/g,"[redacted]"));process.exitCode=1})


