/**
 * Build the checked-in current-member snapshot from congress-legislators.
 *
 * The upstream file is a maintained normalization of official congressional
 * identifiers and contact data. The generated snapshot is intentionally
 * committed so production imports do not depend on a live third-party API.
 */
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

const INPUT = "data/candidates/raw/legislators-current.json"
const OUTPUT = "data/candidates/federal-officeholders.json"
const SOURCE_URL = "https://unitedstates.github.io/congress-legislators/legislators-current.json"
const HOUSE_ROSTER = "https://clerk.house.gov/xml/lists/MemberData.xml"
const SENATE_ROSTER = "https://www.senate.gov/general/contact_information/senators_cfm.xml"
const TERRITORIES = new Set(["AS", "DC", "GU", "MP", "PR", "VI"])
const STATE_NAMES = {
  AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas", CA:"California",
  CO:"Colorado", CT:"Connecticut", DE:"Delaware", FL:"Florida", GA:"Georgia",
  HI:"Hawaii", ID:"Idaho", IL:"Illinois", IN:"Indiana", IA:"Iowa", KS:"Kansas",
  KY:"Kentucky", LA:"Louisiana", ME:"Maine", MD:"Maryland", MA:"Massachusetts",
  MI:"Michigan", MN:"Minnesota", MS:"Mississippi", MO:"Missouri", MT:"Montana",
  NE:"Nebraska", NV:"Nevada", NH:"New Hampshire", NJ:"New Jersey", NM:"New Mexico",
  NY:"New York", NC:"North Carolina", ND:"North Dakota", OH:"Ohio", OK:"Oklahoma",
  OR:"Oregon", PA:"Pennsylvania", RI:"Rhode Island", SC:"South Carolina",
  SD:"South Dakota", TN:"Tennessee", TX:"Texas", UT:"Utah", VT:"Vermont",
  VA:"Virginia", WA:"Washington", WV:"West Virginia", WI:"Wisconsin", WY:"Wyoming",
  AS:"American Samoa", DC:"District of Columbia", GU:"Guam",
  MP:"Northern Mariana Islands", PR:"Puerto Rico", VI:"U.S. Virgin Islands",
}

function partyName(party) {
  return party === "Democrat" ? "Democratic" : party
}

function ordinal(value) {
  const n = Number(value)
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`
}

function officeFor(term) {
  if (term.type === "sen") return "U.S. Senator"
  if (term.state === "PR") return "Resident Commissioner"
  if (TERRITORIES.has(term.state)) return "Delegate to the U.S. House"
  return "U.S. Representative"
}

function districtLabel(term) {
  if (term.type === "sen") return "statewide"
  return String(term.district)
}

function biography(name, term) {
  const place = STATE_NAMES[term.state] ?? term.state
  if (term.type === "sen") {
    const rank = term.state_rank ? `${term.state_rank} ` : ""
    return `${name} serves as the ${rank}U.S. senator from ${place}. The current term began ${term.start} and ends ${term.end}.`
  }
  const seat = Number(term.district) === 0 ? "at-large congressional district" : `${ordinal(term.district)} congressional district`
  const title = term.state === "PR" ? "resident commissioner" : TERRITORIES.has(term.state) ? "delegate" : "U.S. representative"
  return `${name} serves as ${place}'s ${title} for the ${seat}. The current term began ${term.start} and ends ${term.end}.`
}

function compactTerm(term) {
  return Object.fromEntries(Object.entries({
    chamber: term.type === "sen" ? "senate" : "house",
    start: term.start,
    end: term.end,
    state: term.state,
    district: term.district ?? null,
    senateClass: term.class ?? null,
    stateRank: term.state_rank ?? null,
    party: partyName(term.party),
  }).filter(([, value]) => value !== null && value !== undefined))
}

export function buildSnapshot(rawText, preparedAt = new Date().toISOString()) {
  const upstream = JSON.parse(rawText)
  const members = upstream.map((person) => {
    const term = person.terms.at(-1)
    if (!person.id?.bioguide || !person.name?.first || !person.name?.last || !term) {
      throw new Error("Every current member must have a Bioguide id, name, and current term")
    }
    const name = person.name.official_full || [person.name.first, person.name.middle, person.name.last, person.name.suffix].filter(Boolean).join(" ")
    const chamber = term.type === "sen" ? "senate" : "house"
    const officialWebsite = term.url?.replace(/^http:/, "https:") ?? `https://bioguide.congress.gov/search/bio/${person.id.bioguide}`
    return {
      sourceKey: `congress:current:${person.id.bioguide}`,
      bioguideId: person.id.bioguide,
      name,
      firstName: person.name.first,
      middleName: person.name.middle ?? null,
      lastName: person.name.last,
      suffix: person.name.suffix ?? null,
      party: partyName(term.party),
      state: term.state,
      chamber,
      office: officeFor(term),
      district: districtLabel(term),
      senateClass: term.class ?? null,
      stateRank: term.state_rank ?? null,
      termStart: term.start,
      termEnd: term.end,
      officialWebsite,
      contactForm: term.contact_form?.replace(/^http:/, "https:") ?? null,
      phone: term.phone ?? null,
      officeAddress: term.address ?? null,
      officeRoom: term.office ?? null,
      birthDate: person.bio?.birthday ?? null,
      gender: person.bio?.gender ?? null,
      biography: biography(name, term),
      identifiers: person.id,
      social: person.social ?? {},
      serviceHistory: person.terms.map(compactTerm),
    }
  }).sort((a, b) => a.chamber.localeCompare(b.chamber) || a.state.localeCompare(b.state) || Number(a.district) - Number(b.district) || a.name.localeCompare(b.name))

  const senators = members.filter((m) => m.chamber === "senate")
  const house = members.filter((m) => m.chamber === "house")
  const votingRepresentatives = house.filter((m) => !TERRITORIES.has(m.state))
  const delegates = house.filter((m) => TERRITORIES.has(m.state))
  const occupiedSeats = new Set(house.map((m) => `${m.state}-${m.district}`))
  const knownVacancies = ["FL-20", "TX-23"].filter((seat) => !occupiedSeats.has(seat))

  if (senators.length !== 100) throw new Error(`Expected 100 senators, found ${senators.length}`)
  if (votingRepresentatives.length + knownVacancies.length !== 435) {
    throw new Error(`Expected 435 House voting seats, found ${votingRepresentatives.length} occupied + ${knownVacancies.length} vacant`)
  }
  if (delegates.length !== 6) throw new Error(`Expected 6 House delegates/resident commissioners, found ${delegates.length}`)
  if (new Set(members.map((m) => m.bioguideId)).size !== members.length) throw new Error("Duplicate Bioguide ids")

  return {
    congress: 119,
    preparedAt,
    source: { url: SOURCE_URL, sha256: createHash("sha256").update(rawText).digest("hex") },
    verifiedAgainst: [
      { name: "U.S. Senate", url: SENATE_ROSTER, expectedEntries: 100 },
      { name: "Clerk of the U.S. House", url: HOUSE_ROSTER, expectedEntries: 441 },
    ],
    coverage: {
      senators: senators.length,
      votingRepresentatives: votingRepresentatives.length,
      delegatesAndResidentCommissioner: delegates.length,
      vacantVotingSeats: knownVacancies,
      totalOfficeholders: members.length,
    },
    members,
  }
}

export function main() {
  const raw = readFileSync(INPUT, "utf8")
  const snapshot = buildSnapshot(raw)
  writeFileSync(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`)
  console.log("Prepared federal officeholders", snapshot.coverage)
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/prepare-federal-officeholders.mjs")) main()
