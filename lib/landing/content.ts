/**
 * Landing page content.
 *
 * Everything here is static placeholder data, but it is shaped the way a real
 * API response would be: flat, serialisable, id-keyed, no JSX. When the
 * endpoints exist, each `getX()` becomes an async fetch and the components do
 * not change. Icons are stored as names, not components, so the payload stays
 * JSON-safe across that swap.
 *
 * Editorial rule for every string in this file: describe, never rank. No
 * scores, no "best", no ordering that implies a recommendation.
 */

export type IconName =
  | "home"
  | "graduation"
  | "heart-pulse"
  | "line-chart"
  | "cpu"
  | "globe"
  | "leaf"
  | "scale"
  | "receipt"
  | "shield"

export type ElectionLevel = "federal" | "state" | "local"

export type Election = {
  id: string
  /** ISO date; the UI formats it, so a server can send a raw timestamp. */
  date: string
  name: string
  levels: ElectionLevel[]
  /** Days out is derived at render time from `date`, never hardcoded. */
  note: string
}

export type PartyView = {
  id: "democratic" | "independent" | "republican"
  name: string
  shortName: string
  summary: string
  positions: { issue: string; stance: string }[]
}

export type Topic = {
  id: string
  title: string
  icon: IconName
  blurb: string
  /** Small metadata line. A real feed would compute this. */
  meta: string
  trending?: boolean
}

export type Candidate = {
  id: string
  name: string
  office: string
  /**
   * Printed as-is. Real ballots carry more than four parties (Libertarian,
   * Green, No Party Preference), and collapsing them into a tidy union would
   * mean relabelling a candidate's actual registration.
   */
  party: string
  jurisdiction: string
  bio: string
  /** Null until a real photo is attached; the card falls back to initials. */
  photoUrl: string | null
}

export type PolicyArea = {
  id: string
  title: string
  icon: IconName
  blurb: string
  trackedCount: number
}

export type Issue = { id: string; label: string; icon: IconName }

/* ------------------------------------------------------------------ */

export const elections: Election[] = [
  {
    id: "general-2026",
    date: "2026-11-03",
    name: "General Election",
    levels: ["federal", "state", "local"],
    note: "Every race on your ballot",
  },
  {
    id: "municipal-2027",
    date: "2027-03-09",
    name: "Municipal Runoff",
    levels: ["local"],
    note: "City council seats 2 and 5",
  },
  {
    id: "primary-2027",
    date: "2027-06-01",
    name: "Statewide Primary",
    levels: ["federal", "state"],
    note: "Parties pick their nominees",
  },
]

/** Soonest first, past dates dropped. The real feed will need exactly this. */
export function upcomingElections(from: Date = new Date()): Election[] {
  return elections
    .filter((election) => daysUntil(election.date, from) > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export const partyViews: PartyView[] = [
  {
    id: "democratic",
    name: "Democratic Party",
    shortName: "Democratic",
    summary:
      "Generally favors a larger federal role in the economy, broader social programs, and national standards over state-by-state rules.",
    positions: [
      { issue: "Healthcare", stance: "Expand public coverage and subsidies" },
      { issue: "Economy", stance: "Higher taxes on top earners to fund programs" },
      { issue: "Climate", stance: "Faster transition to clean energy" },
      { issue: "Housing", stance: "Federal funding for affordable units" },
    ],
  },
  {
    id: "independent",
    name: "Middle & Independent",
    shortName: "Independent",
    summary:
      "Not a single platform. Independents and moderates borrow from both sides issue by issue, and split tickets more often than either party's base.",
    positions: [
      { issue: "Healthcare", stance: "Keep private plans, widen subsidies" },
      { issue: "Economy", stance: "Pro-market, deficit-conscious" },
      { issue: "Climate", stance: "Gradual shift, mixed energy sources" },
      { issue: "Housing", stance: "Loosen zoning, let supply catch up" },
    ],
  },
  {
    id: "republican",
    name: "Republican Party",
    shortName: "Republican",
    summary:
      "Generally favors smaller federal government, lower taxes, fewer regulations, and pushing decisions down to states and localities.",
    positions: [
      { issue: "Healthcare", stance: "Market competition and state flexibility" },
      { issue: "Economy", stance: "Broad tax cuts and deregulation" },
      { issue: "Climate", stance: "Domestic energy production, fewer mandates" },
      { issue: "Housing", stance: "Local control, private development" },
    ],
  },
]

export const topics: Topic[] = [
  {
    id: "housing",
    title: "Housing",
    icon: "home",
    blurb:
      "Rent, zoning, and who gets to build what. The fight is mostly local, even when the money is federal.",
    meta: "41 bills tracked",
    trending: true,
  },
  {
    id: "ai-tech",
    title: "AI & Technology",
    icon: "cpu",
    blurb:
      "Rules for AI systems, data privacy, and platform liability — moving faster than most legislatures.",
    meta: "New this month",
    trending: true,
  },
  {
    id: "healthcare",
    title: "Healthcare",
    icon: "heart-pulse",
    blurb:
      "Coverage, drug pricing, and what happens to subsidies when they come up for renewal.",
    meta: "28 bills tracked",
  },
  {
    id: "economy",
    title: "Economy",
    icon: "line-chart",
    blurb:
      "Jobs, inflation, tariffs, and the tax code. Where candidates disagree most on the how, less on the goal.",
    meta: "63 bills tracked",
    trending: true,
  },
  {
    id: "immigration",
    title: "Immigration",
    icon: "globe",
    blurb:
      "Border policy, visas, and enforcement. Largely federal, with real effects on city budgets.",
    meta: "19 bills tracked",
  },
  {
    id: "climate",
    title: "Climate",
    icon: "leaf",
    blurb:
      "Emissions targets, energy permitting, and who pays for the grid. Long timelines, short election cycles.",
    meta: "34 bills tracked",
  },
  {
    id: "education",
    title: "Education",
    icon: "graduation",
    blurb:
      "School funding, curriculum decisions, and student debt. Your school board matters more than you'd think.",
    meta: "22 bills tracked",
  },
  {
    id: "criminal-justice",
    title: "Criminal Justice",
    icon: "scale",
    blurb:
      "Policing, sentencing, and pretrial rules — set mostly by states, enforced by people you elect.",
    meta: "17 bills tracked",
  },
]

export const federalCandidates: Candidate[] = [
  {
    id: "fed-1",
    name: "Alina Reyes",
    office: "U.S. Senate",
    party: "Democrat",
    jurisdiction: "Statewide",
    bio: "Two-term state attorney general. Runs on drug pricing and expanding rural broadband.",
    photoUrl: null,
  },
  {
    id: "fed-2",
    name: "Grant Whitfield",
    office: "U.S. Senate",
    party: "Republican",
    jurisdiction: "Statewide",
    bio: "Manufacturing executive, first campaign. Runs on tax cuts and domestic energy permitting.",
    photoUrl: null,
  },
  {
    id: "fed-3",
    name: "Dana Okoro",
    office: "U.S. House · District 7",
    party: "Democrat",
    jurisdiction: "District 7",
    bio: "Incumbent, three terms. Sits on the Energy and Commerce committee.",
    photoUrl: null,
  },
  {
    id: "fed-4",
    name: "Peter Vance",
    office: "U.S. House · District 7",
    party: "Republican",
    jurisdiction: "District 7",
    bio: "County commissioner. Campaigns on small-business regulation and border funding.",
    photoUrl: null,
  },
]

export const localCandidates: Candidate[] = [
  {
    id: "loc-1",
    name: "Maya Fernández",
    office: "Mayor",
    party: "Democrat",
    jurisdiction: "City",
    bio: "Former city planner. Focused on transit frequency and permitting reform.",
    photoUrl: null,
  },
  {
    id: "loc-2",
    name: "Cole Barrett",
    office: "City Council · Ward 3",
    party: "Republican",
    jurisdiction: "Ward 3",
    bio: "Small-business owner. Priorities are street repair and the city budget audit.",
    photoUrl: null,
  },
  {
    id: "loc-3",
    name: "Priya Raman",
    office: "School Board · Seat 2",
    party: "Nonpartisan",
    jurisdiction: "Unified district",
    bio: "High school teacher of 12 years. Running on class sizes and facility repairs.",
    photoUrl: null,
  },
  {
    id: "loc-4",
    name: "Theo Lindqvist",
    office: "County Sheriff",
    party: "Independent",
    jurisdiction: "County",
    bio: "27 years in the department. Campaigns on response times and jail reentry programs.",
    photoUrl: null,
  },
]

export const policyAreas: PolicyArea[] = [
  {
    id: "healthcare",
    title: "Healthcare",
    icon: "heart-pulse",
    blurb: "Coverage, costs, and who pays",
    trackedCount: 28,
  },
  {
    id: "education",
    title: "Education",
    icon: "graduation",
    blurb: "Funding, curriculum, student debt",
    trackedCount: 22,
  },
  {
    id: "economy",
    title: "Economy",
    icon: "line-chart",
    blurb: "Jobs, prices, trade",
    trackedCount: 63,
  },
  {
    id: "housing",
    title: "Housing",
    icon: "home",
    blurb: "Rent, zoning, supply",
    trackedCount: 41,
  },
  {
    id: "taxes",
    title: "Taxes",
    icon: "receipt",
    blurb: "Brackets, credits, deductions",
    trackedCount: 30,
  },
  {
    id: "climate",
    title: "Climate",
    icon: "leaf",
    blurb: "Energy, emissions, resilience",
    trackedCount: 34,
  },
  {
    id: "technology",
    title: "Technology",
    icon: "cpu",
    blurb: "AI rules, privacy, platforms",
    trackedCount: 15,
  },
  {
    id: "criminal-justice",
    title: "Criminal Justice",
    icon: "scale",
    blurb: "Policing, courts, sentencing",
    trackedCount: 17,
  },
]

export const issues: Issue[] = [
  { id: "economy", label: "Economy", icon: "line-chart" },
  { id: "education", label: "Education", icon: "graduation" },
  { id: "healthcare", label: "Healthcare", icon: "heart-pulse" },
  { id: "housing", label: "Housing", icon: "home" },
  { id: "technology", label: "Technology", icon: "cpu" },
  { id: "climate", label: "Climate", icon: "leaf" },
  { id: "immigration", label: "Immigration", icon: "globe" },
  { id: "criminal-justice", label: "Criminal Justice", icon: "scale" },
  { id: "public-safety", label: "Public Safety", icon: "shield" },
]

/** The ballot summary shown in the hero mockup. */
export const ballotPreview = {
  electionName: "2026 General Election",
  date: "2026-11-03",
  races: [
    { id: "senate", office: "U.S. Senate", count: 3 },
    { id: "house", office: "U.S. House", count: 2 },
    { id: "state-house", office: "State House", count: 4 },
    { id: "local", office: "Local & judicial", count: 6 },
  ],
}

/* ------------------------------------------------------------------ */

/** Days between today and an election date, floored at zero. */
export function daysUntil(isoDate: string, from: Date = new Date()): number {
  const target = Date.parse(`${isoDate}T00:00:00Z`)
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  return Math.max(0, Math.round((target - start) / 86_400_000))
}

/** "Nov 3" / "Nov 3, 2026" — stable across server and client, no locale drift. */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

export function formatElectionDate(isoDate: string, withYear = false): string {
  const [year, month, day] = isoDate.split("-").map(Number)
  const base = `${MONTHS[month - 1]} ${day}`
  return withYear ? `${base}, ${year}` : base
}
