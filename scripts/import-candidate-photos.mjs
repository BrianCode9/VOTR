import postgres from "postgres"

import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const API = "https://en.wikipedia.org/w/api.php"
const HEADERS = { "User-Agent": "VOTR/1.0 candidate portrait importer" }
/**
 * @unitedstates/congress-legislators, which carries both an FEC candidate id
 * and an exact Wikipedia title for every sitting member of Congress.
 *
 * Guessing the title from the filed name cannot reach these people. The filing
 * says ERIC ALAN RICK CRAWFORD and the article is "Rick Crawford
 * (politician)"; RANDALL FEENSTRA is "Randy Feenstra"; ASHLEY HINSON ARENHOLZ
 * is "Ashley Hinson". 228 of the 257 portraits this unlocks have a title no
 * casing rule could derive. One of them is a trap: Florida's DANIEL WEBSTER is
 * "Daniel Webster (Florida politician)", and the bare name is the nineteenth
 * century statesman.
 */
const LEGISLATORS_URL = "https://unitedstates.github.io/congress-legislators/legislators-current.json"
const LEGISLATORS_FILE = "data/candidates/raw/legislators-current.json"
let lastRequestAt = 0
const STATES = {
  AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas", CA:"California", CO:"Colorado", CT:"Connecticut", DE:"Delaware", FL:"Florida", GA:"Georgia", HI:"Hawaii", ID:"Idaho", IL:"Illinois", IN:"Indiana", IA:"Iowa", KS:"Kansas", KY:"Kentucky", LA:"Louisiana", ME:"Maine", MD:"Maryland", MA:"Massachusetts", MI:"Michigan", MN:"Minnesota", MS:"Mississippi", MO:"Missouri", MT:"Montana", NE:"Nebraska", NV:"Nevada", NH:"New Hampshire", NJ:"New Jersey", NM:"New Mexico", NY:"New York", NC:"North Carolina", ND:"North Dakota", OH:"Ohio", OK:"Oklahoma", OR:"Oregon", PA:"Pennsylvania", RI:"Rhode Island", SC:"South Carolina", SD:"South Dakota", TN:"Tennessee", TX:"Texas", UT:"Utah", VT:"Vermont", VA:"Virginia", WA:"Washington", WV:"West Virginia", WI:"Wisconsin", WY:"Wyoming", DC:"District of Columbia", US:"United States",
}

export function normalizeTitle(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/_/g, " ").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ")
}

/**
 * A candidate name as a Wikipedia title.
 *
 * MediaWiki titles are case-sensitive after the first character, so a lookup
 * for "WESLEY HUNT" matches nothing while "Wesley Hunt" matches. Most states
 * publish their certified list in caps - 3,849 of 4,517 names here - and only
 * California and Maryland use mixed case, which is the entire reason those
 * were the only two states that ever got portraits.
 *
 * Applied only to names that are entirely uppercase. A name that already
 * carries case is the state's own spelling and is left alone.
 */
export function toWikiTitle(name) {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ")
  if (!trimmed || /[a-z]/.test(trimmed)) return trimmed
  return trimmed
    .split(" ")
    .map(word => word
      .toLowerCase()
      .split("-").map(part => part.split("'").map(bit => bit.charAt(0).toUpperCase() + bit.slice(1)).join("'")).join("-")
      .replace(/(Mc)([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase()))
    .join(" ")
}

export function usableLicense(value) {
  const license = (value ?? "").trim().toLowerCase()
  return license === "cc0" || license === "public domain" || license.startsWith("pd-") || /^cc by(?:-sa)?(?:\s|$)/.test(license)
}

function plain(value) {
  if (!value) return null
  const clean = value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim()
  return clean || null
}

function makeUrl(params) {
  const url = new URL(API)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

async function requestJson(url) {
  let lastError
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const pace = Math.max(0, 3500 - (Date.now() - lastRequestAt))
      if (pace) await new Promise(resolve => setTimeout(resolve, pace))
      lastRequestAt = Date.now()
      const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) })
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error("Wikimedia throttled the photo import (HTTP " + response.status + ")")
        const retryAfter = response.headers.get("retry-after")
        const asSeconds = Number(retryAfter)
        const asDate = retryAfter ? Date.parse(retryAfter) - Date.now() : 0
        const headerDelay = Number.isFinite(asSeconds) && asSeconds > 0 ? asSeconds * 1000 : Math.max(0, asDate)
        const delay = headerDelay || (response.status === 429 ? 60_000 : 2000 * 2 ** attempt)
        await new Promise(resolve => setTimeout(resolve, Math.min(delay, 15000)))
        continue
      }
      if (!response.ok) throw new Error("Wikimedia returned HTTP " + response.status)
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Wikimedia request failed")
}

async function fetchPages(titles) {
  const data = await requestJson(makeUrl({
    action:"query", format:"json", formatversion:"2",
    prop:"pageimages|extracts|description", piprop:"thumbnail|name", pithumbsize:"480",
    exintro:"1", explaintext:"1", exchars:"1600", redirects:"1", titles:titles.join("|"),
  }))
  const query = data.query ?? {}
  // MediaWiki answers under the title it resolved to, not the one asked for,
  // so every rewrite it reports is recorded backwards. An exact title from the
  // legislator dataset is frequently a redirect to the current article name.
  const alias = new Map()
  for (const step of [query.normalized ?? [], query.redirects ?? []]) {
    for (const hop of step) alias.set(normalizeTitle(hop.to), normalizeTitle(hop.from))
  }
  return { pages: query.pages ?? [], alias }
}

/** Walk a resolved page title back to the key the batch asked under. */
export function requestedKey(pageTitle, alias) {
  let key = normalizeTitle(pageTitle)
  const seen = new Set()
  while (alias.has(key) && !seen.has(key)) {
    seen.add(key)
    key = alias.get(key)
  }
  return key
}

/**
 * FEC candidate id to exact Wikipedia title, from the legislator dataset.
 *
 * Cached under data/candidates/raw/ because that directory is the download
 * cache for public source files and is not committed.
 */
export async function loadWikiTitles() {
  if (!existsSync(LEGISLATORS_FILE)) {
    const response = await fetch(LEGISLATORS_URL, { headers: HEADERS, signal: AbortSignal.timeout(60000) })
    if (!response.ok) throw new Error("congress-legislators returned HTTP " + response.status)
    writeFileSync(LEGISLATORS_FILE, await response.text())
  }
  const raw = readFileSync(LEGISLATORS_FILE, "utf8")
  const byFec = new Map()
  for (const person of JSON.parse(raw)) {
    if (!person.id?.wikipedia) continue
    for (const fecId of person.id.fec ?? []) byFec.set(fecId, person.id.wikipedia)
  }
  return { byFec, sha256: createHash("sha256").update(raw).digest("hex") }
}

async function fetchImageInfo(fileNames) {
  const results = new Map()
  const titles = fileNames.map(name => "File:" + name)
  const data = await requestJson(makeUrl({
    action:"query", format:"json", formatversion:"2",
    prop:"imageinfo", iiprop:"url|extmetadata", iiurlwidth:"480",
    redirects:"1", titles:titles.join("|"),
  }))
  for (const page of data.query?.pages ?? []) {
    if (page.imageinfo?.[0]) results.set(normalizeTitle(page.title.replace(/^File:/i, "")), page.imageinfo[0])
  }
  return results
}

export function politicsAndState(candidate, page) {
  const text = (page.description ?? "") + " " + (page.extract ?? "")
  const political = /\b(politician|political candidate|governor|senator|representative|congress(?:man|woman|ional)?|member of (?:the )?u\.s\. house|state legislator|attorney general|mayor|president|vice president)\b/i.test(text)
  const stateName = STATES[candidate.state]
  const stateMatch = candidate.state === "US" || (stateName && new RegExp("\\b" + stateName + "\\b", "i").test(text))
  return Boolean(political && stateMatch)
}

/**
 * A candidate is looked up under its exact title when the FEC id resolved one,
 * and otherwise under the name cased into a plausible title.
 *
 * `verified` marks the first kind. For those the legislator dataset has already
 * established that this FEC id is this article, which is a stronger identity
 * claim than reading the article text, so the politician-and-state heuristic is
 * not applied: it exists to stop a guessed title from matching a stranger, and
 * a guess is exactly what these rows no longer are.
 */
export function lookupTitle(candidate) {
  return candidate.wikiTitle
    ? { title: candidate.wikiTitle, verified: true }
    : { title: toWikiTitle(candidate.name), verified: false }
}

export async function resolvePhotos(candidates, checkpoint, saveCheckpoint) {
  const byTitle = new Map()
  for (const candidate of candidates) {
    const { title, verified } = lookupTitle(candidate)
    const key = normalizeTitle(title)
    if (!key) continue
    const group = byTitle.get(key) ?? { title, verified, rows: [] }
    // A verified title wins the group, so one member of Congress sharing a
    // normalized name with another filer does not fall back to guessing.
    if (verified && !group.verified) { group.title = title; group.verified = true }
    group.rows.push(candidate)
    byTitle.set(key, group)
  }

  const accepts = (group, candidate, page) => group.verified || politicsAndState(candidate, page)

  const entries = [...byTitle.entries()]
  for (let start = checkpoint.nextPageIndex; start < entries.length; start += 50) {
    const batch = entries.slice(start, start + 50)
    console.log("Checking candidate pages", start + 1, "to", start + batch.length, "of", entries.length)
    const { pages, alias } = await fetchPages(batch.map((entry) => entry[1].title))
    const index = new Map(pages.map(page => [requestedKey(page.title, alias), page]))
    for (const [key, group] of batch) {
      const page = index.get(key)
      if (page && !page.missing && page.pageimage && page.thumbnail?.source && group.rows.some(candidate => accepts(group, candidate, page))) {
        checkpoint.pages[key] = page
      }
    }
    checkpoint.nextPageIndex = start + batch.length
    saveCheckpoint()
  }

  const matches = []
  for (const [key, page] of Object.entries(checkpoint.pages)) {
    const group = byTitle.get(key)
    for (const candidate of group?.rows ?? []) {
      if (accepts(group, candidate, page)) matches.push({ candidate, page })
    }
  }
  const fileNames = [...new Set(matches.map(({ page }) => page.pageimage))]
  for (let start = checkpoint.nextFileIndex; start < fileNames.length; start += 50) {
    const batch = fileNames.slice(start, start + 50)
    console.log("Checking image licenses", start + 1, "to", start + batch.length, "of", fileNames.length)
    const info = await fetchImageInfo(batch)
    for (const [key, value] of info) checkpoint.imageInfo[key] = value
    checkpoint.nextFileIndex = start + batch.length
    saveCheckpoint()
  }
  const infoByFile = new Map(Object.entries(checkpoint.imageInfo))
  const photos = []
  for (const { candidate, page } of matches) {
    const info = infoByFile.get(normalizeTitle(page.pageimage))
    const metadata = info?.extmetadata ?? {}
    const license = plain(metadata.LicenseShortName?.value ?? metadata.UsageTerms?.value)
    const imageUrl = info?.thumburl ?? page.thumbnail?.source
    if (!imageUrl || !license || !usableLicense(license) || !info?.descriptionurl) continue
    photos.push({
      candidate_id: candidate.id,
      image_url: imageUrl,
      source_page: "https://en.wikipedia.org/wiki/" + encodeURIComponent(page.title.replace(/ /g, "_")),
      file_page: info.descriptionurl,
      creator: plain(metadata.Attribution?.value ?? metadata.Artist?.value ?? metadata.Credit?.value),
      license_name: license,
      license_url: plain(metadata.LicenseUrl?.value),
    })
  }
  return photos
}

async function main() {
  try { process.loadEnvFile(".env.local") } catch { /* CI may supply env another way. */ }
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required")
  const sql = postgres(url, { max:1, connect_timeout:20 })
  try {
    // --state=PA,WV scopes the run. Wikipedia is paced at 3.5s a request, so a
    // whole-country pass is ~20 minutes; scoping it makes a single state a
    // minute and lets a checkpoint stay valid per scope.
    const stateArg = process.argv.find(a => a.startsWith("--state="))
    const onlyStates = stateArg ? stateArg.slice(8).split(",").map(s => s.trim().toUpperCase()).filter(Boolean) : null
    const { byFec, sha256 } = await loadWikiTitles()
    const candidates = (await sql.unsafe("select c.id,c.name,d.state,r.office,r.level,cs.source_record->>'fecId' as fec_id from candidates c join races r on r.id=c.race_id join districts d on d.id=r.district_id left join candidate_sources cs on cs.candidate_id=c.id order by c.name,d.state"))
      .filter(row => !onlyStates || onlyStates.includes(row.state))
      .map(row => ({ ...row, wikiTitle: row.fec_id ? byFec.get(row.fec_id) ?? null : null }))
    const verified = candidates.filter(row => row.wikiTitle).length
    console.log("Legislator dataset:", byFec.size, "FEC ids with an exact title -", verified, "of", candidates.length, "candidates resolved by id")
    if (onlyStates) console.log("Scoped to", onlyStates.join(", "), "-", candidates.length, "candidates")
    const checkpointPath = onlyStates
      ? `data/candidates/candidate-photo-progress.${onlyStates.join("-").toLowerCase()}.json`
      : "data/candidates/candidate-photo-progress.json"
    const fingerprint = createHash("sha256").update(candidates.map(row => [row.id,row.name,row.state,row.office,row.wikiTitle ?? ""].join("|")).join("\n")).digest("hex")
    let checkpoint = { version:2, fingerprint, nextPageIndex:0, pages:{}, nextFileIndex:0, imageInfo:{} }
    if (!process.argv.includes("--fresh") && existsSync(checkpointPath)) {
      checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8"))
      if (checkpoint.version !== 2 || checkpoint.fingerprint !== fingerprint) throw new Error("Photo lookup checkpoint does not match these candidate records; rerun with --fresh")
    }
    const saveCheckpoint = () => writeFileSync(checkpointPath, JSON.stringify(checkpoint))
    const photos = await resolvePhotos(candidates, checkpoint, saveCheckpoint)
    const licenseCounts = Object.fromEntries([...new Set(photos.map(row => row.license_name))].map(license => [license, photos.filter(row => row.license_name === license).length]))
    const report = { candidates:candidates.length, resolvedByFecId:verified, legislatorDatasetSha256:sha256, acceptedPhotos:photos.length, noSafeMatch:candidates.length-photos.length, applied:false, licenseCounts }
    console.log(JSON.stringify(report, null, 2))
    if (!process.argv.includes("--apply")) return
    let upserted = 0
    for (let start = 0; start < photos.length; start += 100) {
      const rows = photos.slice(start, start+100)
      const columns = ["candidate_id", "image_url", "source_page", "file_page", "creator", "license_name", "license_url"]
      const values = rows.flatMap(row => columns.map(column => row[column]))
      const placeholders = rows.map((_, rowIndex) => `(${columns.map((__, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(",")},now())`).join(",")
      const result = await sql.unsafe(`insert into candidate_photos (${columns.join(",")},fetched_at) values ${placeholders} on conflict (candidate_id) do update set image_url=excluded.image_url,source_page=excluded.source_page,file_page=excluded.file_page,creator=excluded.creator,license_name=excluded.license_name,license_url=excluded.license_url,fetched_at=now() returning 1`, values)
      upserted += result.length
    }
    console.log(JSON.stringify({ ...report, applied:true, rowsUpserted:upserted }, null, 2))
  } finally {
    await sql.end()
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/import-candidate-photos.mjs")) {
  main().catch(error => { console.error("Candidate photo import failed:", error.code ?? error.name, error.message); process.exitCode=1 })
}
