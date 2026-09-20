/** Fetch explicitly associated primary sources. Publication is a separate reviewed import. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { htmlToText } from "../lib/adapters/html-to-text"
import { loadSnapshot } from "./import-candidates"

const root = "data/candidates/raw/pa-wv"
mkdirSync(root, { recursive: true })
const seeds = JSON.parse(readFileSync("data/candidates/pa-wv-sources.json", "utf8")) as { fecId: string; url: string; kind: string }[]
const snapshot = loadSnapshot()
type Page = { sourceKey: string; name: string; state: string; url: string; seedUrl: string; kind: string; title: string; rawText: string; fetchedAt: string; sha256: string }
const pages: Page[] = existsSync(root + "/documents.json") ? JSON.parse(readFileSync(root + "/documents.json", "utf8")) : []
const failures: { url: string; reason: string }[] = []
async function fetchPage(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(18000) })
  if (!r.ok) throw new Error("HTTP " + r.status)
  if (!r.headers.get("content-type")?.includes("text/html")) throw new Error("Not HTML")
  const html = await r.text()
  if (html.length > 4_000_000) throw new Error("Page too large")
  const title = htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "Candidate source")
  if (/just a moment|access denied|domain for sale|captcha/i.test(title)) throw new Error("Blocked or parked page")
  return { html, url: r.url, title }
}
async function work(seed: typeof seeds[number]) {
  const c = snapshot.candidates.find(c => c.sourceRecord.fecId === seed.fecId && ["PA", "WV"].includes(c.state))
  if (!c) throw new Error("Unknown identity " + seed.fecId)
  if (pages.some(p => p.seedUrl === seed.url)) return
  try {
    const home = await fetchPage(seed.url)
    const queue = [home.url]
    const seen = new Set<string>()
    const origin = new URL(home.url).origin
    while (queue.length && seen.size < 14) {
      const url = queue.shift()!
      if (seen.has(url)) continue
      seen.add(url)
      try {
        const page = url === home.url ? home : await fetchPage(url)
        if (new URL(page.url).origin !== origin) throw new Error("Off-site redirect; needs review")
        // Some Senate pages close scripts with legal HTML whitespace. Canonicalize
        // the tag in NEW snapshots so the legacy converter doesn't swallow prose.
        const rawText = htmlToText(page.html.replace(/<\/script\s+>/gi, "</script>").replace(/<\/style\s+>/gi, "</style>"))
        if (rawText.length < 150) throw new Error("Too little text")
        const sha256 = createHash("sha256").update(rawText).digest("hex")
        pages.push({ sourceKey: c.sourceKey, name: c.name, state: c.state, url: page.url, seedUrl: seed.url, kind: seed.kind, title: page.title, rawText, fetchedAt: new Date().toISOString(), sha256 })
        writeFileSync(root + "/" + sha256 + ".html", page.html)
        for (const m of page.html.matchAll(/href=["']([^"']+)["']/gi)) {
          try {
            const link = new URL(m[1].replace(/&amp;/g, "&"), page.url); link.hash = ""
            if (link.origin === origin && /issues|priorities|platform|policies|vision|about|meet-|biography/i.test(link.pathname) && !/\.(pdf|jpg|png)$/i.test(link.pathname) && !seen.has(link.href) && !queue.includes(link.href)) queue.push(link.href)
          } catch {}
        }
      } catch (e) { failures.push({ url, reason: (e as Error).message }) }
    }
    console.log(c.state, c.name, pages.filter(p => p.seedUrl === seed.url).length, "pages")
  } catch (e) { failures.push({ url: seed.url, reason: (e as Error).message }); console.log("Unavailable", seed.url) }
  writeFileSync(root + "/documents.json", JSON.stringify(pages, null, 2) + "\n")
}
async function main() {
  const queue = [...seeds]
  await Promise.all(Array.from({ length: 5 }, async () => { while (queue.length) await work(queue.shift()!) }))
  writeFileSync(root + "/failures.json", JSON.stringify(failures, null, 2) + "\n")
  console.log("Stored", pages.length, "pages; failures", failures.length)
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
