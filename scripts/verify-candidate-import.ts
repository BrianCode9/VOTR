/** Read-only audit of the imported snapshot and every curated quote. */
import {readFileSync,writeFileSync} from "node:fs"
import postgres from "postgres"
import {loadSnapshot,candidateId,stableId} from "./import-candidates"
async function main(){
 process.loadEnvFile(".env.local")
 if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL missing")
 const snapshot=loadSnapshot()
 const claims=JSON.parse(readFileSync("data/candidates/policy-claims-2026.json","utf8").replace(/^\uFEFF/,"")) as {name:string;state:string;sourceUrl:string;issueTag:string;quote:string;positionText:string}[]
 const sql=postgres(process.env.DATABASE_URL,{max:1,connect_timeout:20})
 try{
  const rows=await sql.unsafe("select s.*, c.name,c.party,c.incumbent,r.office,r.level,r.election_date,d.state,d.type,d.geo_id from candidate_sources s join candidates c on c.id=s.candidate_id join races r on r.id=c.race_id join districts d on d.id=r.district_id")
  const byKey=new Map(rows.map(r=>[r.source_key,r]))
  for(const c of snapshot.candidates){
   const r=byKey.get(c.sourceKey)
   if(!r||r.candidate_id!==candidateId(c)||r.name!==c.name||r.party!==c.party||r.state!==c.state||r.office!==c.office||r.level!==c.level||r.election_stage!==c.electionStage||r.candidacy_status!==c.candidacyStatus||r.incumbent_known!==c.incumbentKnown||r.geo_id!=="US-"+c.state+"-"+c.districtType+"-"+c.district||new Date(r.election_date).toISOString()!=="2026-11-03T00:00:00.000Z")
    throw new Error("Candidate audit mismatch: "+c.sourceKey)
   if(!r.source_url.startsWith("https://")||!r.source_record.sourceSha256)throw new Error("Missing provenance")
  }
  const insights=await sql.unsafe("select i.*,d.raw_text,d.url from insights i join documents d on d.id=i.document_id join candidate_sources s on s.candidate_id=i.candidate_id")
  const byId=new Map(insights.map(i=>[i.id,i]))
  for(const c of claims){
   const candidate=snapshot.candidates.find(r=>r.name===c.name&&r.state===c.state)!
   const id=stableId("insight:"+candidateId(candidate)+":"+c.sourceUrl+":"+c.issueTag+":"+c.quote)
   const r=byId.get(id)
   if(!r||r.raw_text.slice(r.quote_char_start,r.quote_char_end)!==c.quote||r.position_text!==c.positionText||r.status!=="published"||r.judge_rating!==null)
    throw new Error("Policy audit mismatch: "+c.name+" / "+c.issueTag)
  }
  const [totals]=await sql.unsafe("select (select count(*) from candidates)::int candidates,(select count(*) from documents)::int documents,(select count(*) from insights)::int insights")
  const coverage=await sql.unsafe("select s.source_name,r.level,count(*)::int candidates from candidate_sources s join candidates c on c.id=s.candidate_id join races r on r.id=c.race_id group by s.source_name,r.level order by s.source_name,r.level")
  const report={verifiedAt:new Date().toISOString(),candidateRecordsVerified:snapshot.candidates.length,policyQuotesVerified:claims.length,candidatesWithCuratedPolicies:new Set(claims.map(c=>c.state+":"+c.name)).size,localRecordsImported:rows.filter(r=>r.level==="local").length,coverage,databaseTotals:totals}
  if(report.localRecordsImported)throw new Error("Local records unexpectedly imported")
  writeFileSync("data/candidates/verification-report.json",JSON.stringify(report,null,2)+"\n")
  console.log(JSON.stringify(report,null,2))
 }finally{await sql.end()}
}
main().catch(e=>{console.error("Audit failed:",e.code??e.name,e.message?.replace(/postgres(?:ql)?:\/\/\S+/g,"[redacted]"));process.exitCode=1})

