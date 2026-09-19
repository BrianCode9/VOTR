/** Import free source documents and explicitly curated, exact-quote policy claims.
 * npm run data:policies -- --apply
 */
import {readFileSync,writeFileSync} from "node:fs"
import {createHash} from "node:crypto"
import postgres from "postgres"
import {z} from "zod"
import {htmlToText} from "../lib/adapters/html-to-text"
import {issueTagSchema} from "../lib/schemas/insight"
import {loadSnapshot,candidateId,stableId} from "./import-candidates"
const claimSchema=z.object({name:z.string(),state:z.string(),sourceKind:z.enum(["voter_guide","campaign"]),sourceFile:z.string().optional(),sourceUrl:z.string().url(),issueTag:issueTagSchema,quote:z.string().min(10),positionText:z.string().min(10),attribution:z.enum(["own_words","characterization"])})
type Source={url:string;rawText:string;title:string;sourceName:string;sourceType:string;fetchedAt:string;sourceKeys:string[]}
const parse=(path:string)=>JSON.parse(readFileSync(path,"utf8").replace(/^\uFEFF/,""))
async function main(){
 const snapshot=loadSnapshot()
 const claims=z.array(claimSchema).parse(parse("data/candidates/policy-claims-2026.json"))
 const sections=parse("data/candidates/policy-source-sections.json") as {file:string;name:string;text:string}[]
 const campaign=parse("data/candidates/raw/campaign-documents.json") as {documents:{url:string;title:string;rawText:string;fetchedAt:string;sourceKeys:string[]}[];failures:unknown[]}
 const sources=new Map<string,Source>()
 for(const d of campaign.documents){
  if(/access denied|just a moment|attention required|domain for sale/i.test(d.title))continue
  const names=d.sourceKeys.map(k=>snapshot.candidates.find(c=>c.sourceKey===k)?.name).filter(Boolean)
  sources.set(d.url,{...d,sourceName:"Campaign website: "+names.join(" / "),sourceType:"campaign"})
 }
 for(const section of sections){
  const name=section.name.split("|")[0].trim()
  const matches=snapshot.candidates.filter(c=>c.state==="CA"&&c.name===name)
  if(matches.length!==1)throw new Error("Ambiguous guide identity: "+name)
  const slug=section.file.replace(/^ca-/,"").replace(/\.html$/,"")
  const url="https://voterguide.sos.ca.gov/candidates/"+slug+"-candidate-statements.htm"
  if(!sources.has(url)){
   const html=readFileSync("data/candidates/raw/"+section.file,"utf8")
   sources.set(url,{url,rawText:htmlToText(html),title:"2026 California "+matches[0].office+" candidate statements",sourceName:"California voter guide (candidate-submitted statements)",sourceType:"candidate_statement",fetchedAt:snapshot.preparedAt,sourceKeys:[]})
  }
  sources.get(url)!.sourceKeys.push(matches[0].sourceKey)
 }
 const verified=claims.map(c=>{
  const candidates=snapshot.candidates.filter(r=>r.name===c.name&&r.state===c.state)
  if(candidates.length!==1)throw new Error("Ambiguous policy identity: "+c.name)
  const candidate=candidates[0],source=sources.get(c.sourceUrl)
  if(!source||!source.sourceKeys.includes(candidate.sourceKey))throw new Error("Source not associated with candidate: "+c.name)
  if(c.sourceKind==="voter_guide"){
   const section=sections.find(s=>s.file===c.sourceFile&&s.name.split("|")[0].trim()===c.name)
   if(!section?.text.includes(c.quote))throw new Error("Quote not in candidate's own section: "+c.name)
  }
  const start=source.rawText.indexOf(c.quote)
  if(start<0||source.rawText.indexOf(c.quote,start+1)>=0)throw new Error("Missing or ambiguous exact quote: "+c.name+" / "+c.issueTag)
  return {...c,candidateId:candidateId(candidate),start,end:start+c.quote.length}
 })
 console.log("Validated",verified.length,"policy claims;",sources.size,"source documents")
 if(!process.argv.includes("--apply"))return
 try{process.loadEnvFile(".env.local")}catch{}
 if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL missing")
 const sql=postgres(process.env.DATABASE_URL,{max:1,connect_timeout:20})
 const report={documentsInserted:0,insightsInserted:0,claimsValidated:verified.length,sourceDocuments:sources.size,campaignFetchFailures:campaign.failures.length,applied:false}
 try{
  await sql.begin(async tx=>{
   await tx.unsafe("select pg_advisory_xact_lock(20862026)")
   const documentIds=new Map<string,string>()
   const candidateDocuments=new Map<string,Set<string>>()
   for(const s of sources.values()){
    const hash=createHash("sha256").update(s.rawText).digest("hex")
    const existing=await tx.unsafe("select id,raw_text from documents where url=$1",[s.url])
    // Never change raw_text. A changed page receives a content-version fragment.
    const url=existing.length&&existing[0].raw_text!==s.rawText?s.url.split("#")[0]+"#votr-content-"+hash.slice(0,16):s.url
    const id=existing.length&&url===s.url?existing[0].id:stableId("document:"+url+":"+hash)
    const inserted=await tx.unsafe("insert into documents (id,url,source_type,source_name,title,raw_text,fetched_at,media_type,is_synthetic) values ($1,$2,$3,$4,$5,$6,$7,'article',false) on conflict (url) do nothing returning id",[id,url,s.sourceType,s.sourceName,s.title,s.rawText,s.fetchedAt])
    report.documentsInserted+=inserted.length
    const [stored]=await tx.unsafe("select id,raw_text from documents where url=$1",[url])
    if(stored.raw_text!==s.rawText)throw new Error("Immutable document mismatch")
    documentIds.set(s.url,stored.id)
    for(const key of s.sourceKeys){
     if(!candidateDocuments.has(key))candidateDocuments.set(key,new Set())
     candidateDocuments.get(key)!.add(stored.id)
    }
   }
   for(const c of verified){
    const id=stableId("insight:"+c.candidateId+":"+c.sourceUrl+":"+c.issueTag+":"+c.quote)
    const documentId=documentIds.get(c.sourceUrl)!
    const [document]=await tx.unsafe("select raw_text from documents where id=$1",[documentId])
    if(document.raw_text.slice(c.start,c.end)!==c.quote)throw new Error("Stored quote mismatch")
    const inserted=await tx.unsafe("insert into insights (id,document_id,candidate_id,issue_tag,position_text,plain_language,quote_char_start,quote_char_end,attribution,status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'published') on conflict (id) do nothing returning id",[id,documentId,c.candidateId,c.issueTag,c.positionText,c.positionText,c.start,c.end,c.attribution])
    report.insightsInserted+=inserted.length
   }
   for(const [key,ids] of candidateDocuments){
    await tx.unsafe("update candidate_sources set source_record=source_record || jsonb_build_object('policyDocumentIds',$1::text::jsonb) where source_key=$2",[JSON.stringify([...ids]),key])
   }
  })
  report.applied=true
  writeFileSync("data/candidates/policy-import-report.json",JSON.stringify(report,null,2)+"\n")
  console.log("COMMITTED",report)
 }finally{await sql.end()}
}
main().catch(e=>{console.error("Policy import failed:",e.code??e.name,e.message?.replace(/postgres(?:ql)?:\/\/\S+/g,"[redacted]"));process.exitCode=1})

