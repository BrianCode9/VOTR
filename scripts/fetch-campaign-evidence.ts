/** Fetch candidate-authored pages linked from the official Maryland roster.
 * Candidate association is explicit; no positions are inferred or published here.
 */
import {writeFileSync,mkdirSync} from "node:fs"
import {createHash} from "node:crypto"
import {htmlToText} from "../lib/adapters/html-to-text"
import {loadSnapshot} from "./import-candidates"
const snapshot=loadSnapshot()
const groups=new Map<string,string[]>()
for(const c of snapshot.candidates.filter(c=>c.state==="MD" && (c.level==="federal" || c.district==="statewide") && c.campaignWebsite)) {
 try {
  const url=new URL(c.campaignWebsite!)
  if(!["http:","https:"].includes(url.protocol)||!url.hostname.includes(".")||/^[\d.]+$/.test(url.hostname)||url.hostname.endsWith(".local")) continue
  const keys=groups.get(url.href)??[]
  keys.push(c.sourceKey);groups.set(url.href,keys)
 }catch{}
}
const documents: {url:string;file:string;sourceKeys:string[];fetchedAt:string;title:string;rawText:string}[]=[]
const failures: {url:string;reason:string}[]=[]
mkdirSync("data/candidates/raw/campaigns",{recursive:true})
async function get(url:string) {
 const r=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{"User-Agent":"VOTR-Hackathon-Research/1.0"}})
 if(!r.ok) throw new Error("HTTP "+r.status)
 if(!r.headers.get("content-type")?.includes("text/html")) throw new Error("Not HTML")
 const html=await r.text()
 if(html.length>3_000_000) throw new Error("Page exceeds size limit")
 return {html,url:r.url}
}
async function work(entry:[string,string[]]) {
 const [start,sourceKeys]=entry
 try {
  const home=await get(start)
  const origin=new URL(home.url).origin
  const links=[...new Set([...home.html.matchAll(/href=["']([^"'#]+)["']/gi)].map(m=>{try{return new URL(m[1],home.url).href}catch{return ""}}))]
   .filter(u=>u.startsWith(origin+"/")&&/\/(issues?|priorities|platform|policies|vision)(\/|$|-|\?)/i.test(u))
   .slice(0,3)
  const pages=[home]
  for(const url of links) {
   if(url===home.url) continue
   try{pages.push(await get(url))}catch(e){failures.push({url,reason:(e as Error).message})}
  }
  for(const page of pages) {
   const rawText=htmlToText(page.html)
   if(rawText.length<200) {failures.push({url:page.url,reason:"Too little readable text"});continue}
   const file="campaigns/"+createHash("sha256").update(page.url).digest("hex").slice(0,20)+".html"
   writeFileSync("data/candidates/raw/"+file,page.html)
   const title=htmlToText(page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??"Candidate campaign page")
   documents.push({url:page.url,file,sourceKeys,fetchedAt:new Date().toISOString(),title,rawText})
  }
  console.log("Fetched",start,pages.length,"pages")
 } catch(e) {failures.push({url:start,reason:(e as Error).message});console.log("Unavailable",start)}
}
const queue=[...groups.entries()]
async function worker(){while(queue.length){const item=queue.shift();if(item)await work(item)}}
async function main() { await Promise.all(Array.from({length:4},()=>worker()))
writeFileSync("data/candidates/raw/campaign-documents.json",JSON.stringify({documents,failures},null,2))
console.log("Campaign sources",documents.length,"failures",failures.length)


}
main().catch(e=>{console.error(e.message);process.exitCode=1})


