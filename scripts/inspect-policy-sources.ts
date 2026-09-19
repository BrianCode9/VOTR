import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { htmlToText } from "../lib/adapters/html-to-text"
const root = "data/candidates/raw"
const blocks: unknown[] = []
for (const file of readdirSync(root).filter(f=>/^ca-.*\.html$/.test(f))) {
  const html = readFileSync(root+"/"+file,"utf8")
  const headings = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
  for (let i=0;i<headings.length;i++) {
    const name = htmlToText(headings[i][1])
    if (!name.includes("|") && !(file==="ca-superintendent.html" && ["Richard Barrera","Sonja Shaw"].includes(name))) continue
    const body = html.slice(headings[i].index!+headings[i][0].length, headings[i+1]?.index ?? html.length)
    const text = htmlToText(body.split(/<hr\b/i)[0])
    blocks.push({file,name,text})
  }
}
writeFileSync("data/candidates/policy-source-sections.json",JSON.stringify(blocks,null,2))
console.log(JSON.stringify(blocks,null,2))

