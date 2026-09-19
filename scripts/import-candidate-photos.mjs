import postgres from "postgres"

import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const API = "https://en.wikipedia.org/w/api.php"
const HEADERS = { "User-Agent": "VOTR/1.0 candidate portrait importer" }
let lastRequestAt = 0
const STATES = {
  AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas", CA:"California", CO:"Colorado", CT:"Connecticut", DE:"Delaware", FL:"Florida", GA:"Georgia", HI:"Hawaii", ID:"Idaho", IL:"Illinois", IN:"Indiana", IA:"Iowa", KS:"Kansas", KY:"Kentucky", LA:"Louisiana", ME:"Maine", MD:"Maryland", MA:"Massachusetts", MI:"Michigan", MN:"Minnesota", MS:"Mississippi", MO:"Missouri", MT:"Montana", NE:"Nebraska", NV:"Nevada", NH:"New Hampshire", NJ:"New Jersey", NM:"New Mexico", NY:"New York", NC:"North Carolina", ND:"North Dakota", OH:"Ohio", OK:"Oklahoma", OR:"Oregon", PA:"Pennsylvania", RI:"Rhode Island", SC:"South Carolina", SD:"South Dakota", TN:"Tennessee", TX:"Texas", UT:"Utah", VT:"Vermont", VA:"Virginia", WA:"Washington", WV:"West Virginia", WI:"Wisconsin", WY:"Wyoming", DC:"District of Columbia", US:"United States",
}

export function normalizeTitle(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/_/g, " ").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ")
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
    exintro:"1", explaintext:"1", exchars:"1600", titles:titles.join("|"),
  }))
  return data.query?.pages ?? []
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

export async function resolvePhotos(candidates, checkpoint, saveCheckpoint) {
  const byTitle = new Map()
  for (const candidate of candidates) {
    const key = normalizeTitle(candidate.name)
    if (!key) continue
    const rows = byTitle.get(key) ?? []
    rows.push(candidate)
    byTitle.set(key, rows)
  }

  const entries = [...byTitle.entries()]
  for (let start = checkpoint.nextPageIndex; start < entries.length; start += 50) {
    const batch = entries.slice(start, start + 50)
    console.log("Checking candidate pages", start + 1, "to", start + batch.length, "of", entries.length)
    const pages = await fetchPages(batch.map((entry) => entry[1][0].name))
    const index = new Map(pages.map(page => [normalizeTitle(page.title), page]))
    for (const [key, rows] of batch) {
      const page = index.get(key)
      if (page && !page.missing && page.pageimage && page.thumbnail?.source && rows.some(candidate => politicsAndState(candidate, page))) {
        checkpoint.pages[key] = page
      }
    }
    checkpoint.nextPageIndex = start + batch.length
    saveCheckpoint()
  }

  const matches = []
  for (const [key, page] of Object.entries(checkpoint.pages)) {
    for (const candidate of byTitle.get(key) ?? []) {
      if (politicsAndState(candidate, page)) matches.push({ candidate, page })
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
    const candidates = await sql.unsafe("select c.id,c.name,d.state,r.office,r.level from candidates c join races r on r.id=c.race_id join districts d on d.id=r.district_id order by c.name,d.state")
    const checkpointPath = "data/candidates/candidate-photo-progress.json"
    const fingerprint = createHash("sha256").update(candidates.map(row => [row.id,row.name,row.state,row.office].join("|")).join("\n")).digest("hex")
    let checkpoint = { version:1, fingerprint, nextPageIndex:0, pages:{}, nextFileIndex:0, imageInfo:{} }
    if (!process.argv.includes("--fresh") && existsSync(checkpointPath)) {
      checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8"))
      if (checkpoint.version !== 1 || checkpoint.fingerprint !== fingerprint) throw new Error("Photo lookup checkpoint does not match these candidate records; rerun with --fresh")
    }
    const saveCheckpoint = () => writeFileSync(checkpointPath, JSON.stringify(checkpoint))
    const photos = await resolvePhotos(candidates, checkpoint, saveCheckpoint)
    const licenseCounts = Object.fromEntries([...new Set(photos.map(row => row.license_name))].map(license => [license, photos.filter(row => row.license_name === license).length]))
    const report = { candidates:candidates.length, acceptedPhotos:photos.length, noSafeMatch:candidates.length-photos.length, applied:false, licenseCounts }
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
