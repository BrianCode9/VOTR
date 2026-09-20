import type { Checkability, RelevanceKind } from "../schemas/insight"

/**
 * The demo dataset.
 *
 * A frontend cannot be built against a feed that only fills when someone runs
 * a crawl and pays for a model call, and a demo cannot depend on the network
 * being awake. This is a fixed set of documents and insights that covers every
 * enum value a component branches on, at least once each:
 *
 *   flags               NEW, FLIP_FLOP, UNVERIFIED_CLAIM, and none
 *   confidenceLabel     high, medium, low
 *   presentationMode    stated, nudge_verify
 *   cardType            all four
 *   checkability        all three
 *   factCheckStatus     unresolved, supported, disputed, false
 *   quoteVerified       exact and fuzzy
 *   corroboration       1 source, 2 sources, 3 sources
 *
 * Two rules this file follows, and they are the reason it is data rather than
 * SQL:
 *
 * 1. Every quote is a literal substring of its document's `text`. The offsets
 *    are NOT written here; the seeder finds each quote with indexOf and fails
 *    loudly if it is not there. Hand-written offsets in a fixture are how a
 *    demo ends up rendering a garbled half-sentence while every test passes.
 *
 * 2. The prose is invented, and the people are invented. Nothing here is a
 *    real quote from a real politician. Fixtures that look like real coverage
 *    end up screenshotted, and an app whose entire claim is traceability must
 *    not circulate a fabricated quote attributed to a real person. The
 *    documents are also marked `isSynthetic`, which the card component already
 *    badges.
 */

/** Fixture documents are keyed by this prefix, which is how a reset finds them. */
export const DEMO_URL_PREFIX = "https://demo.votr.invalid/"

export interface DemoSpeaker {
  key: string
  name: string
  /** Other spellings the fixtures use, to exercise alias resolution. */
  aliases: string[]
  party: string
  role: string
}

export const DEMO_SPEAKERS: readonly DemoSpeaker[] = [
  {
    key: "chen",
    name: "Maya Chen",
    // "Rep. Maya Chen" and "Maya Chen" must resolve to one person, or her
    // timeline splits in half. This is the case the speakers table exists for.
    aliases: ["Rep. Maya Chen", "Representative Maya Chen"],
    party: "Democratic",
    role: "U.S. House, Demo district",
  },
  {
    key: "okafor",
    name: "Daniel Okafor",
    aliases: ["Dan Okafor", "Councilmember Daniel Okafor"],
    party: "Republican",
    role: "City Council, Demo district",
  },
  {
    key: "reyes",
    name: "Priya Reyes",
    aliases: ["Mayor Priya Reyes"],
    party: "Independent",
    role: "Mayor, Demo city",
  },
]

export interface DemoDocument {
  key: string
  /** Appended to DEMO_URL_PREFIX. Also the reset key, so it must be stable. */
  slug: string
  sourceName: string
  title: string
  /** ISO date. The timeline orders on this, so the spread here is the point. */
  publishedAt: string
  mediaType: "article" | "transcript"
  text: string
}

export const DEMO_DOCUMENTS: readonly DemoDocument[] = [
  {
    key: "gazette-rent-2025",
    slug: "gazette/rent-cap-hearing",
    sourceName: "Demo Gazette",
    title: "Council hears three hours of testimony on a rent cap",
    publishedAt: "2025-03-11T14:00:00.000Z",
    mediaType: "article",
    text: `The council chamber ran past nine on Tuesday, with more than forty residents signed up to speak on a proposal that would limit annual rent increases in buildings older than fifteen years.

Rep. Maya Chen, who represents the district in Congress and has no vote on the measure, came anyway. "A cap on rent increases is a blunt instrument, and I do not support one here," she told the room. She argued the city should be issuing permits faster instead, and pointed to a backlog she described as the real constraint.

Councilmember Daniel Okafor disagreed, and did so at length. "We can permit every tower in the plan and a family still gets a letter in March saying their rent went up four hundred dollars," he said. He asked the city attorney twice whether a cap could be written to exempt new construction.

The city's housing office told the council that permit review currently takes an average of eleven months, a figure that drew audible reaction from the gallery.

No vote was taken. The measure returns to committee in April.`,
  },
  {
    key: "ledger-rent-2026",
    slug: "ledger/chen-shifts-on-rent",
    sourceName: "Riverside Ledger",
    title: "Chen now backs a rent cap, citing eviction filings",
    publishedAt: "2026-02-04T11:30:00.000Z",
    mediaType: "article",
    text: `Nearly a year after telling a packed council chamber that a rent cap was "a blunt instrument," Maya Chen said Wednesday that she now supports one.

"I was wrong about the rent cap. I want a cap at three percent, and I want it this year," Chen said at a press conference outside the county courthouse. She cited eviction filings, which the county clerk's office reports have risen for six consecutive quarters.

Asked what changed, she pointed to the permit backlog she had argued was the real problem. "We fixed the permits and rents went up anyway. I have to look at what actually happened," she said.

Daniel Okafor, who has supported a cap since 2024, called the shift welcome and overdue.

Chen's office said she will introduce a federal version of the measure, though similar bills have not advanced in the current session.`,
  },
  {
    key: "broadcast-rent-2026",
    slug: "broadcast/chen-rent-interview",
    sourceName: "Demo Public Radio",
    title: "Interview: Chen on housing, permits, and changing her mind",
    publishedAt: "2026-02-09T16:00:00.000Z",
    mediaType: "transcript",
    text: `HOST: You spent a year arguing against a rent cap. Now you want one.

CHEN: I did, and I do. I support capping rent increases at three percent a year, and I'd rather say plainly that I changed my mind than pretend I always thought this.

HOST: What convinced you?

CHEN: Eviction filings went up six quarters straight while we were speeding up permits. At some point the numbers are the argument.

HOST: Critics say a cap reduces supply.

CHEN: They might be right about new buildings, which is why I'd exempt anything built in the last fifteen years. I am not certain that exemption is enough. I want to be honest that this is a judgment call and not a settled question.

HOST: Mayor Reyes has called the proposal unworkable.

CHEN: She has, and we disagree.`,
  },
  {
    key: "gazette-transit-2026",
    slug: "gazette/reyes-transit-plan",
    sourceName: "Demo Gazette",
    title: "Reyes unveils a bus plan and a number nobody can source",
    publishedAt: "2026-05-20T09:00:00.000Z",
    mediaType: "article",
    text: `Mayor Priya Reyes presented a transit plan on Monday that would add fourteen bus routes over four years and make all routes free for riders under nineteen.

"Every student in this city will ride free, and we will add fourteen routes without raising a single tax," Reyes said.

Pressed on the funding, her office pointed to a projected increase in federal transit grants. "Federal transit funding to cities like ours has doubled in the last three years," Reyes said, a claim her office could not immediately document when asked.

Riders who depend on the two routes serving the east side would see service every twelve minutes instead of every twenty-five, according to the plan. Advocates for those neighborhoods called the change the most consequential part of the proposal.

Daniel Okafor said he would support the routes but not the fare change.`,
  },
  {
    key: "ledger-transit-2026",
    slug: "ledger/free-fares-east-side",
    sourceName: "Riverside Ledger",
    title: "What free fares would mean on the east side",
    publishedAt: "2026-05-22T13:15:00.000Z",
    mediaType: "article",
    text: `The mayor's transit proposal would make every route free for riders under nineteen, a change that falls hardest on the two east-side lines where the median rider is a high school student.

"Every student in this city will ride free," Priya Reyes said when she introduced the plan, and her office has not backed away from the commitment since.

Transit staff estimate the fare change costs about nine million dollars a year. The plan covers it with grant money that has not been awarded.

Students on the east side currently wait up to twenty-five minutes between buses, and the plan would cut that to twelve.

Okafor, who represents part of the corridor, said the frequency change matters more than the fare.`,
  },
  {
    key: "gazette-climate-2026",
    slug: "gazette/okafor-climate-vote",
    sourceName: "Demo Gazette",
    title: "Okafor breaks with his party on the emissions ordinance",
    publishedAt: "2026-06-30T18:45:00.000Z",
    mediaType: "article",
    text: `Daniel Okafor cast the deciding vote Monday for an ordinance requiring new municipal buildings to run without on-site fossil fuel combustion.

"I'm voting for this because the buildings we put up this decade are the buildings we're stuck with in 2060," Okafor said before the vote.

He was the only member of his caucus to do so. Party officials declined to comment.

The ordinance applies only to buildings the city itself constructs, which is roughly two or three projects a year.

Okafor has not previously taken a public position on emissions rules.`,
  },
]

export interface DemoInsight {
  documentKey: string
  speakerKey: string | null
  cardType: "stance" | "stance_change" | "factual_claim" | "voter_relevance"
  topic: string
  topics: string[]
  headline: string
  plainLanguage: string
  plainLanguageSummary: string | null
  /** MUST be a literal substring of the document's text. Checked by the seeder. */
  quote: string
  attribution: "own_words" | "characterization"
  /** Drives confidenceLabel, verifyYourself and presentationMode. */
  claimSupportConfidence: number
  /** The family confidence: the flip-flop gate for stance changes, else 1. */
  confidence: number
  quoteVerified: "exact" | "normalized" | "transcript" | "fuzzy"
  quoteSimilarity: number
  flags: ("NEW" | "FLIP_FLOP" | "UNVERIFIED_CLAIM")[]
  factCheckStatus: "unresolved" | "supported" | "disputed" | "false"
  factCheckSource: string | null
  payload:
    | { cardType: "stance" }
    | { cardType: "stance_change"; previousPosition: string; priorInsightId: string | null }
    | { cardType: "factual_claim"; checkability: Checkability }
    | { cardType: "voter_relevance"; relevanceKind: RelevanceKind; affectedGroup: string }
}

/**
 * Written to exercise the branches, not to be representative.
 *
 * The three rent-cap positions across three outlets are what makes the
 * corroboration count interesting: Chen's 2026 position appears in the Ledger
 * and on Public Radio, so it should settle at two sources, while her 2025
 * position appears once and stays at one. The transit claim appears twice from
 * two outlets. If a change to the matcher makes those numbers move, the
 * fixture has caught it.
 */
export const DEMO_INSIGHTS: readonly DemoInsight[] = [
  /* ---- Chen, housing, 2025: the position she later reverses ---- */
  {
    documentKey: "gazette-rent-2025",
    speakerKey: "chen",
    cardType: "stance",
    topic: "housing",
    topics: ["housing"],
    headline: "Opposes a cap on annual rent increases, favouring faster permitting instead.",
    plainLanguage:
      "She does not want a limit on rent increases and says the city should approve new housing faster.",
    plainLanguageSummary:
      "Chen says limiting rent increases is the wrong tool and wants faster building approvals instead.",
    quote:
      '"A cap on rent increases is a blunt instrument, and I do not support one here,"',
    attribution: "own_words",
    claimSupportConfidence: 0.95,
    confidence: 0.95,
    quoteVerified: "exact",
    quoteSimilarity: 1,
    flags: ["NEW"],
    factCheckStatus: "unresolved",
    factCheckSource: null,
    payload: { cardType: "stance" },
  },
  {
    documentKey: "gazette-rent-2025",
    speakerKey: "okafor",
    cardType: "stance",
    topic: "housing",
    topics: ["housing", "economy"],
    headline: "Supports a rent cap, arguing new supply alone does not reach current tenants.",
    plainLanguage:
      "He wants a limit on rent increases because building more homes does not help people facing a raise right now.",
    plainLanguageSummary:
      "Okafor wants a rent cap, saying new construction does not help a family whose rent goes up in March.",
    quote:
      '"We can permit every tower in the plan and a family still gets a letter in March saying their rent went up four hundred dollars,"',
    attribution: "own_words",
    claimSupportConfidence: 0.82,
    confidence: 0.82,
    quoteVerified: "exact",
    quoteSimilarity: 1,
    flags: ["NEW"],
    factCheckStatus: "unresolved",
    factCheckSource: null,
    payload: { cardType: "stance" },
  },
  {
    documentKey: "gazette-rent-2025",
    speakerKey: null,
    cardType: "factual_claim",
    topic: "housing",
    topics: ["housing"],
    headline: "Permit review in the city currently takes an average of eleven months.",
    plainLanguage: "City staff said it takes about eleven months on average to approve a building permit.",
    plainLanguageSummary: null,
    quote:
      "permit review currently takes an average of eleven months",
    attribution: "characterization",
    claimSupportConfidence: 0.9,
    confidence: 1,
    quoteVerified: "exact",
    quoteSimilarity: 1,
    flags: ["UNVERIFIED_CLAIM"],
    factCheckStatus: "unresolved",
    factCheckSource: null,
    payload: { cardType: "factual_claim", checkability: "easily_checkable" },
  },

  /* ---- Chen, housing, 2026: the flip-flop, from two outlets ---- */
  {
    documentKey: "ledger-rent-2026",
    speakerKey: "chen",
    cardType: "stance_change",
    topic: "housing",
    topics: ["housing", "economy"],
    headline: "Supports capping annual rent increases at three percent.",
    plainLanguage: "She now wants to limit rent increases to three percent a year.",
    plainLanguageSummary:
      "Chen now wants rent increases capped at three percent a year, after saying a year ago that a cap was the wrong tool.",
    quote:
      '"I was wrong about the rent cap. I want a cap at three percent, and I want it this year,"',
    attribution: "own_words",
    claimSupportConfidence: 0.97,
    confidence: 0.94,
    quoteVerified: "exact",
    quoteSimilarity: 1,
    flags: ["FLIP_FLOP"],
    factCheckStatus: "unresolved",
    factCheckSource: null,
    payload: {
      cardType: "stance_change",
      previousPosition:
        "Opposes a cap on annual rent increases, favouring faster permitting instead.",
      priorInsightId: null,
    },
  },
  {
    documentKey: "ledger-rent-2026",
    speakerKey: null,
    cardType: "factual_claim",
    topic: "housing",
    topics: ["housing"],
    headline: "Eviction filings in the county have risen for six consecutive quarters.",
    plainLanguage: "The county says eviction filings have gone up for a year and a half straight.",
    plainLanguageSummary: null,
    quote: "have risen for six consecutive quarters",
    attribution: "characterization",
    claimSupportConfidence: 0.88,
    confidence: 1,
    quoteVerified: "exact",
    quoteSimilarity: 1,
    flags: [],
    factCheckStatus: "supported",
    factCheckSource: "County clerk quarterly filings report",
    payload: { cardType: "factual_claim", checkability: "easily_checkable" },
  },
  {
    documentKey: "broadcast-rent-2026",
    speakerKey: "chen",
    cardType: "stance",
    topic: "housing",
    topics: ["housing"],
    headline: "Supports capping rent increases at three percent a year.",
    plainLanguage: "She wants rent increases limited to three percent each year.",
    plainLanguageSummary: "Chen supports a three percent annual cap on rent increases.",
    quote: "I support capping rent increases at three percent a year",
    attribution: "own_words",
    claimSupportConfidence: 1,
    confidence: 1,
    quoteVerified: "transcript",
    quoteSimilarity: 1,
    flags: [],
    factCheckStatus: "unresolved",
    factCheckSource: null,
    payload: { cardType: "stance" },
  },
  {
    documentKey: "broadcast-rent-2026",
    speakerKey: "chen",
    cardType: "voter_relevance",
    topic: "housing",
    topics: ["housing"],
    headline:
      "Renters in buildings older than fifteen years would see increases limited; newer buildings would be exempt.",
    plainLanguage:
      "If it passes, people in older buildings get a limit on increases, and people in newer ones do not.",
    plainLanguageSummary: null,
    quote: "I'd exempt anything built in the last fifteen years",
    attribution: "own_words",
    claimSupportConfidence: 0.71,
    confidence: 1,
    quoteVerified: "transcript",
    quoteSimilarity: 1,
    flags: [],
    factCheckStatus: "unresolved",
    factCheckSource: null,
    payload: {
      cardType: "voter_relevance",
      relevanceKind: "opportunity",
      affectedGroup: "renters in buildings older than fifteen years",
    },
  },
  {
    documentKey: "broadcast-rent-2026",
    speakerKey: "chen",
    cardType: "factual_claim",
    topic: "housing",
    topics: ["housing"],
    headline: "A rent cap of this kind would not reduce the supply of new housing.",
    plainLanguage: "Whether a rent cap slows down new building is not something this interview settles.",
    plainLanguageSummary: null,
    // Deliberately the low-confidence card: the quote is Chen conceding the
    // opposite may be true, which supports the headline only by inference.
    // This is what `nudge_verify` is for.
    quote: "They might be right about new buildings",
    attribution: "own_words",
    claimSupportConfidence: 0.31,
    confidence: 1,
    quoteVerified: "transcript",
    quoteSimilarity: 1,
    flags: ["UNVERIFIED_CLAIM"],
    factCheckStatus: "disputed",
    factCheckSource: "Demo economics review panel",
    payload: { cardType: "factual_claim", checkability: "requires_expertise" },
  },

  /* ---- Reyes, transit: a claim that does not hold up, across two outlets ---- */
  {
    documentKey: "gazette-transit-2026",
    speakerKey: "reyes",
    cardType: "stance",
    topic: "transit_and_infrastructure",
    topics: ["transit_and_infrastructure"],
    headline: "Supports making every bus route free for riders under nineteen.",
    plainLanguage: "She wants bus rides to be free for anyone under nineteen.",
    plainLanguageSummary: "Reyes wants free bus fares for every rider under nineteen.",
    quote: '"Every student in this city will ride free, and we will add fourteen routes without raising a single tax,"',
    attribution: "own_words",
    claimSupportConfidence: 0.93,
    confidence: 0.93,
    quoteVerified: "exact",
    quoteSimilarity: 1,
    flags: ["NEW"],
    factCheckStatus: "unresolved",
    factCheckSource: null,
    payload: { cardType: "stance" },
  },
  {
    documentKey: "gazette-transit-2026",
    speakerKey: "reyes",
    cardType: "factual_claim",
    topic: "transit_and_infrastructure",
    topics: ["transit_and_infrastructure", "taxes_and_budget"],
    headline: "Federal transit funding to comparable cities has doubled in the last three years.",
    plainLanguage: "She said federal money for buses in cities like this one has doubled since 2023.",
    plainLanguageSummary: null,
    quote:
      '"Federal transit funding to cities like ours has doubled in the last three years,"',
    attribution: "own_words",
    claimSupportConfidence: 0.96,
    confidence: 1,
    quoteVerified: "exact",
    quoteSimilarity: 1,
    flags: ["UNVERIFIED_CLAIM"],
    factCheckStatus: "false",
    factCheckSource: "Federal Transit Administration apportionment tables",
    payload: { cardType: "factual_claim", checkability: "easily_checkable" },
  },
  {
    documentKey: "gazette-transit-2026",
    speakerKey: "reyes",
    cardType: "voter_relevance",
    topic: "transit_and_infrastructure",
    topics: ["transit_and_infrastructure"],
    headline:
      "East-side riders on the two lines serving those neighbourhoods would wait twelve minutes instead of twenty-five.",
    plainLanguage: "People on the east side would wait about half as long for a bus.",
    plainLanguageSummary: null,
    quote: "would see service every twelve minutes instead of every twenty-five",
    attribution: "characterization",
    claimSupportConfidence: 0.87,
    confidence: 1,
    quoteVerified: "exact",
    quoteSimilarity: 1,
    flags: [],
    factCheckStatus: "unresolved",
    factCheckSource: null,
    payload: {
      cardType: "voter_relevance",
      relevanceKind: "opportunity",
      affectedGroup: "riders on the two east-side bus lines",
    },
  },
  {
    documentKey: "ledger-transit-2026",
    speakerKey: "reyes",
    cardType: "stance",
    topic: "transit_and_infrastructure",
    topics: ["transit_and_infrastructure"],
    headline: "Supports free bus fares for every rider under nineteen.",
    plainLanguage: "She wants everyone under nineteen to ride the bus for free.",
    plainLanguageSummary: null,
    quote: '"Every student in this city will ride free,"',
    attribution: "own_words",
    claimSupportConfidence: 0.91,
    confidence: 0.91,
    quoteVerified: "exact",
    quoteSimilarity: 1,
    flags: [],
    factCheckStatus: "unresolved",
    factCheckSource: null,
    payload: { cardType: "stance" },
  },
  {
    documentKey: "ledger-transit-2026",
    speakerKey: null,
    cardType: "factual_claim",
    topic: "transit_and_infrastructure",
    topics: ["transit_and_infrastructure", "taxes_and_budget"],
    headline: "The fare change would cost roughly nine million dollars a year.",
    plainLanguage: "Transit staff put the cost of free fares at about nine million dollars a year.",
    plainLanguageSummary: null,
    // A fuzzy match: the stored offsets point at real text, the model's string
    // differed slightly. Exercises the "quote was corrected" path in the UI.
    quote: "estimate the fare change costs about nine million dollars a year",
    attribution: "characterization",
    claimSupportConfidence: 0.79,
    confidence: 1,
    quoteVerified: "fuzzy",
    quoteSimilarity: 0.93,
    flags: ["UNVERIFIED_CLAIM"],
    factCheckStatus: "unresolved",
    factCheckSource: null,
    payload: { cardType: "factual_claim", checkability: "requires_expertise" },
  },

  /* ---- Okafor, climate: a first position, and an unfalsifiable claim ---- */
  {
    documentKey: "gazette-climate-2026",
    speakerKey: "okafor",
    cardType: "stance",
    topic: "climate",
    topics: ["climate"],
    headline:
      "Supports requiring new municipal buildings to run without on-site fossil fuel combustion.",
    plainLanguage: "He voted for a rule that new city buildings cannot burn gas or oil on site.",
    plainLanguageSummary:
      "Okafor backed a rule stopping new city buildings from burning fuel on site.",
    quote:
      '"I\'m voting for this because the buildings we put up this decade are the buildings we\'re stuck with in 2060,"',
    attribution: "own_words",
    claimSupportConfidence: 0.89,
    confidence: 0.89,
    quoteVerified: "exact",
    quoteSimilarity: 1,
    flags: ["NEW"],
    factCheckStatus: "unresolved",
    factCheckSource: null,
    payload: { cardType: "stance" },
  },
  {
    documentKey: "gazette-climate-2026",
    speakerKey: "okafor",
    cardType: "factual_claim",
    topic: "climate",
    topics: ["climate"],
    headline: "Buildings constructed this decade will still be in use in 2060.",
    plainLanguage: "He says buildings put up now will still be standing in 2060.",
    plainLanguageSummary: null,
    quote: "the buildings we put up this decade are the buildings we're stuck with in 2060",
    attribution: "own_words",
    claimSupportConfidence: 0.46,
    confidence: 1,
    quoteVerified: "exact",
    quoteSimilarity: 1,
    flags: ["UNVERIFIED_CLAIM"],
    factCheckStatus: "unresolved",
    factCheckSource: null,
    payload: { cardType: "factual_claim", checkability: "unverifiable" },
  },
]
