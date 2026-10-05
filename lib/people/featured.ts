import { similarity } from "../extract/fuzzy"
import { normalizeSpeakerName } from "../speakers/normalize"

export type PoliticalParty = "Democratic" | "Republican" | "Independent" | "Nonpartisan"

export interface FeaturedPoliticalFigure {
  slug: string
  name: string
  aliases: string[]
  recordAliases: string[]
  party: PoliticalParty
  role: string
  summary: string
  sourceUrl: string
  sourceLabel: string
  reviewedAt: string
}

type SourceKind = "white-house" | "senate" | "house" | "governors" | "ratings"

const SOURCES: Record<SourceKind, { url: string; label: string }> = {
  "white-house": {
    url: "https://www.whitehouse.gov/administration/",
    label: "White House administration",
  },
  senate: {
    url: "https://www.senate.gov/senators/",
    label: "United States Senate roster",
  },
  house: {
    url: "https://www.house.gov/representatives",
    label: "United States House roster",
  },
  governors: {
    url: "https://www.nga.org/governors/",
    label: "National Governors Association roster",
  },
  ratings: {
    url: "https://yougov.com/en-us/ratings/politicians",
    label: "YouGov U.S. politicians ratings, Q2 2026",
  },
}

function figure(
  slug: string,
  name: string,
  party: PoliticalParty,
  role: string,
  sourceKind: SourceKind,
  aliases: string[] = [],
  recordAliases: string[] = [name],
): FeaturedPoliticalFigure {
  const source = SOURCES[sourceKind]
  return {
    slug,
    name,
    aliases,
    recordAliases,
    party,
    role,
    summary: `A nationally prominent U.S. political figure known for serving as ${role}.`,
    sourceUrl: source.url,
    sourceLabel: source.label,
    reviewedAt: "2026-09-20",
  }
}

/**
 * Starter coverage for nationally prominent U.S. political figures.
 *
 * This is deliberately an unranked coverage set, not an endorsement or a
 * claim that number 1 is more important than number 100. It combines people
 * with high national name recognition and holders of major federal, state,
 * party, or judicial roles. Metadata is hardcoded so search never depends on
 * whether the ingestion pipeline happened to encounter someone first.
 */
export const FEATURED_POLITICAL_FIGURES: readonly FeaturedPoliticalFigure[] = [
  figure("donald-trump", "Donald Trump", "Republican", "President of the United States", "white-house", ["Donald J. Trump", "President Trump"], ["Donald Trump", "Trump"]),
  figure("jd-vance", "JD Vance", "Republican", "Vice President of the United States", "white-house", ["J.D. Vance", "James David Vance"]),
  figure("joe-biden", "Joe Biden", "Democratic", "46th president of the United States", "ratings", ["Joseph R. Biden Jr.", "Joseph Biden"]),
  figure("kamala-harris", "Kamala Harris", "Democratic", "49th vice president of the United States", "ratings", ["Kamala D. Harris"]),
  figure("barack-obama", "Barack Obama", "Democratic", "44th president of the United States", "ratings", ["Barack H. Obama"]),
  figure("george-w-bush", "George W. Bush", "Republican", "43rd president of the United States", "ratings", ["George Bush"]),
  figure("bill-clinton", "Bill Clinton", "Democratic", "42nd president of the United States", "ratings", ["William Jefferson Clinton"]),
  figure("hillary-clinton", "Hillary Clinton", "Democratic", "former secretary of state and 2016 Democratic presidential nominee", "ratings", ["Hillary Rodham Clinton"]),
  figure("mike-pence", "Mike Pence", "Republican", "48th vice president of the United States", "ratings", ["Michael Pence"]),
  figure("bernie-sanders", "Bernie Sanders", "Independent", "U.S. senator from Vermont", "senate", ["Bernard Sanders"]),
  figure("alexandria-ocasio-cortez", "Alexandria Ocasio-Cortez", "Democratic", "U.S. representative from New York", "house", ["AOC", "Rep. Ocasio-Cortez"]),
  figure("elizabeth-warren", "Elizabeth Warren", "Democratic", "U.S. senator from Massachusetts", "senate"),
  figure("cory-booker", "Cory Booker", "Democratic", "U.S. senator from New Jersey", "senate"),
  figure("robert-f-kennedy-jr", "Robert F. Kennedy Jr.", "Independent", "U.S. secretary of health and human services", "white-house", ["RFK Jr.", "Robert Kennedy Jr."]),
  figure("pete-buttigieg", "Pete Buttigieg", "Democratic", "former U.S. transportation secretary and presidential candidate", "ratings", ["Peter Buttigieg", "Mayor Pete"]),
  figure("gavin-newsom", "Gavin Newsom", "Democratic", "governor of California", "governors"),
  figure("tim-walz", "Tim Walz", "Democratic", "governor of Minnesota and 2024 vice-presidential nominee", "governors", ["Timothy Walz"]),
  figure("mark-kelly", "Mark Kelly", "Democratic", "U.S. senator from Arizona", "senate"),
  figure("jasmine-crockett", "Jasmine Crockett", "Democratic", "U.S. representative from Texas", "house"),
  figure("zohran-mamdani", "Zohran Mamdani", "Democratic", "mayor of New York City", "ratings"),
  figure("marco-rubio", "Marco Rubio", "Republican", "U.S. secretary of state", "white-house", ["Marco A. Rubio"]),
  figure("tulsi-gabbard", "Tulsi Gabbard", "Republican", "director of national intelligence", "white-house"),
  figure("kristi-noem", "Kristi Noem", "Republican", "U.S. secretary of homeland security", "white-house"),
  figure("pam-bondi", "Pam Bondi", "Republican", "attorney general of the United States", "white-house", ["Pamela Bondi"]),
  figure("pete-hegseth", "Pete Hegseth", "Republican", "U.S. secretary of defense", "white-house", ["Peter Hegseth"]),
  figure("nikki-haley", "Nikki Haley", "Republican", "former U.N. ambassador and presidential candidate", "ratings", ["Nimrata Haley"]),
  figure("vivek-ramaswamy", "Vivek Ramaswamy", "Republican", "businessman and former presidential candidate", "ratings"),
  figure("ron-desantis", "Ron DeSantis", "Republican", "governor of Florida", "governors", ["Ronald DeSantis"]),
  figure("greg-abbott", "Greg Abbott", "Republican", "governor of Texas", "governors", ["Gregory Abbott"]),
  figure("gretchen-whitmer", "Gretchen Whitmer", "Democratic", "governor of Michigan", "governors"),
  figure("josh-shapiro", "Josh Shapiro", "Democratic", "governor of Pennsylvania", "governors"),
  figure("wes-moore", "Wes Moore", "Democratic", "governor of Maryland", "governors", ["Westley Moore"]),
  figure("jb-pritzker", "JB Pritzker", "Democratic", "governor of Illinois", "governors", ["J.B. Pritzker", "Jay Robert Pritzker"]),
  figure("andy-beshear", "Andy Beshear", "Democratic", "governor of Kentucky", "governors", ["Andrew Beshear"]),
  figure("sarah-huckabee-sanders", "Sarah Huckabee Sanders", "Republican", "governor of Arkansas", "governors", ["Sarah Sanders"]),
  figure("brian-kemp", "Brian Kemp", "Republican", "governor of Georgia", "governors"),
  figure("glenn-youngkin", "Glenn Youngkin", "Republican", "former governor of Virginia", "ratings"),
  figure("abigail-spanberger", "Abigail Spanberger", "Democratic", "governor of Virginia", "governors"),
  figure("kathy-hochul", "Kathy Hochul", "Democratic", "governor of New York", "governors", ["Kathleen Hochul"]),
  figure("jared-polis", "Jared Polis", "Democratic", "governor of Colorado", "governors"),
  figure("chuck-schumer", "Chuck Schumer", "Democratic", "U.S. senator from New York and Senate Democratic leader", "senate", ["Charles Schumer"]),
  figure("john-thune", "John Thune", "Republican", "U.S. senator from South Dakota and Senate majority leader", "senate"),
  figure("mitch-mcconnell", "Mitch McConnell", "Republican", "U.S. senator from Kentucky and former Senate Republican leader", "senate", ["Addison Mitchell McConnell"]),
  figure("ted-cruz", "Ted Cruz", "Republican", "U.S. senator from Texas", "senate", ["Rafael Edward Cruz"]),
  figure("lindsey-graham", "Lindsey Graham", "Republican", "U.S. senator from South Carolina", "senate"),
  figure("tim-scott", "Tim Scott", "Republican", "U.S. senator from South Carolina", "senate"),
  figure("josh-hawley", "Josh Hawley", "Republican", "U.S. senator from Missouri", "senate", ["Joshua Hawley"]),
  figure("tom-cotton", "Tom Cotton", "Republican", "U.S. senator from Arkansas", "senate", ["Thomas Cotton"]),
  figure("rand-paul", "Rand Paul", "Republican", "U.S. senator from Kentucky", "senate", ["Randal Paul"]),
  figure("susan-collins", "Susan Collins", "Republican", "U.S. senator from Maine", "senate"),
  figure("lisa-murkowski", "Lisa Murkowski", "Republican", "U.S. senator from Alaska", "senate"),
  figure("amy-klobuchar", "Amy Klobuchar", "Democratic", "U.S. senator from Minnesota", "senate"),
  figure("kirsten-gillibrand", "Kirsten Gillibrand", "Democratic", "U.S. senator from New York", "senate"),
  figure("raphael-warnock", "Raphael Warnock", "Democratic", "U.S. senator from Georgia", "senate"),
  figure("jon-ossoff", "Jon Ossoff", "Democratic", "U.S. senator from Georgia", "senate", ["Thomas Jonathan Ossoff"]),
  figure("john-fetterman", "John Fetterman", "Democratic", "U.S. senator from Pennsylvania", "senate"),
  figure("tammy-duckworth", "Tammy Duckworth", "Democratic", "U.S. senator from Illinois", "senate", ["Ladda Tammy Duckworth"]),
  figure("tammy-baldwin", "Tammy Baldwin", "Democratic", "U.S. senator from Wisconsin", "senate"),
  figure("chris-murphy", "Chris Murphy", "Democratic", "U.S. senator from Connecticut", "senate", ["Christopher Murphy"]),
  figure("adam-schiff", "Adam Schiff", "Democratic", "U.S. senator from California", "senate"),
  figure("mike-johnson", "Mike Johnson", "Republican", "speaker of the U.S. House of Representatives", "house", ["James Michael Johnson"]),
  figure("hakeem-jeffries", "Hakeem Jeffries", "Democratic", "House Democratic leader and U.S. representative from New York", "house"),
  figure("nancy-pelosi", "Nancy Pelosi", "Democratic", "former speaker and U.S. representative from California", "house"),
  figure("steve-scalise", "Steve Scalise", "Republican", "House majority leader and U.S. representative from Louisiana", "house", ["Stephen Scalise"]),
  figure("jim-jordan", "Jim Jordan", "Republican", "U.S. representative from Ohio", "house", ["James Jordan"]),
  figure("marjorie-taylor-greene", "Marjorie Taylor Greene", "Republican", "U.S. representative from Georgia", "house", ["MTG"]),
  figure("lauren-boebert", "Lauren Boebert", "Republican", "U.S. representative from Colorado", "house"),
  figure("nancy-mace", "Nancy Mace", "Republican", "U.S. representative from South Carolina", "house"),
  figure("byron-donalds", "Byron Donalds", "Republican", "U.S. representative from Florida", "house"),
  figure("dan-crenshaw", "Dan Crenshaw", "Republican", "U.S. representative from Texas", "house", ["Daniel Crenshaw"]),
  figure("thomas-massie", "Thomas Massie", "Republican", "U.S. representative from Kentucky", "house"),
  figure("ro-khanna", "Ro Khanna", "Democratic", "U.S. representative from California", "house", ["Rohit Khanna"]),
  figure("jamie-raskin", "Jamie Raskin", "Democratic", "U.S. representative from Maryland", "house", ["Jamin Raskin"]),
  figure("ilhan-omar", "Ilhan Omar", "Democratic", "U.S. representative from Minnesota", "house"),
  figure("rashida-tlaib", "Rashida Tlaib", "Democratic", "U.S. representative from Michigan", "house"),
  figure("ayanna-pressley", "Ayanna Pressley", "Democratic", "U.S. representative from Massachusetts", "house"),
  figure("maxwell-frost", "Maxwell Frost", "Democratic", "U.S. representative from Florida", "house"),
  figure("elise-stefanik", "Elise Stefanik", "Republican", "U.S. representative from New York", "house"),
  figure("katie-porter", "Katie Porter", "Democratic", "former U.S. representative from California", "ratings"),
  figure("adam-kinzinger", "Adam Kinzinger", "Republican", "former U.S. representative from Illinois", "ratings"),
  figure("liz-cheney", "Liz Cheney", "Republican", "former U.S. representative from Wyoming", "ratings", ["Elizabeth Cheney"]),
  figure("stacey-abrams", "Stacey Abrams", "Democratic", "former Georgia gubernatorial nominee and voting-rights organizer", "ratings"),
  figure("beto-orourke", "Beto O'Rourke", "Democratic", "former U.S. representative and statewide candidate in Texas", "ratings", ["Robert Francis O'Rourke", "Beto ORourke"]),
  figure("andrew-yang", "Andrew Yang", "Independent", "former presidential and New York mayoral candidate", "ratings"),
  figure("arnold-schwarzenegger", "Arnold Schwarzenegger", "Republican", "former governor of California", "ratings"),
  figure("doug-burgum", "Doug Burgum", "Republican", "U.S. secretary of the interior and former North Dakota governor", "white-house", ["Douglas Burgum"]),
  figure("elon-musk", "Elon Musk", "Independent", "business executive and political donor", "ratings"),
  figure("michelle-obama", "Michelle Obama", "Democratic", "former first lady of the United States", "ratings", ["Michelle LaVaughn Robinson Obama"]),
  figure("al-gore", "Al Gore", "Democratic", "45th vice president of the United States", "ratings", ["Albert Gore Jr."]),
  figure("john-kerry", "John Kerry", "Democratic", "former secretary of state and 2004 presidential nominee", "ratings"),
  figure("mitt-romney", "Mitt Romney", "Republican", "former U.S. senator, Massachusetts governor, and 2012 presidential nominee", "ratings", ["Willard Mitt Romney"]),
  figure("chris-christie", "Chris Christie", "Republican", "former governor of New Jersey and presidential candidate", "ratings", ["Christopher Christie"]),
  figure("john-roberts", "John Roberts", "Nonpartisan", "chief justice of the United States", "ratings", ["John G. Roberts Jr."]),
  figure("clarence-thomas", "Clarence Thomas", "Nonpartisan", "associate justice of the U.S. Supreme Court", "ratings"),
  figure("sonia-sotomayor", "Sonia Sotomayor", "Nonpartisan", "associate justice of the U.S. Supreme Court", "ratings"),
  figure("ketanji-brown-jackson", "Ketanji Brown Jackson", "Nonpartisan", "associate justice of the U.S. Supreme Court", "ratings"),
  figure("samuel-alito", "Samuel Alito", "Nonpartisan", "associate justice of the U.S. Supreme Court", "ratings", ["Samuel A. Alito Jr."]),
  figure("amy-coney-barrett", "Amy Coney Barrett", "Nonpartisan", "associate justice of the U.S. Supreme Court", "ratings"),
  figure("brett-kavanaugh", "Brett Kavanaugh", "Nonpartisan", "associate justice of the U.S. Supreme Court", "ratings"),
  figure("neil-gorsuch", "Neil Gorsuch", "Nonpartisan", "associate justice of the U.S. Supreme Court", "ratings"),
] as const

export function getFeaturedPoliticalFigure(slug: string): FeaturedPoliticalFigure | null {
  return FEATURED_POLITICAL_FIGURES.find((person) => person.slug === slug) ?? null
}

export function searchFeaturedPoliticalFigures(
  rawQuery: string,
  limit = 12,
): FeaturedPoliticalFigure[] {
  const query = normalizeSpeakerName(rawQuery)
  if (query.length < 2) return []

  return FEATURED_POLITICAL_FIGURES
    .map((person) => {
      const names = [person.name, ...person.aliases].map(normalizeSpeakerName)
      const contains = names.some((name) => name.includes(query) || query.includes(name))
      const score = Math.max(...names.map((name) => similarity(query, name)))
      return { person, contains, score }
    })
    .filter(({ contains, score }) => contains || score >= 0.78)
    .sort((a, b) => {
      if (a.contains !== b.contains) return a.contains ? -1 : 1
      if (a.score !== b.score) return b.score - a.score
      return a.person.name.localeCompare(b.person.name)
    })
    .slice(0, Math.max(1, limit))
    .map(({ person }) => person)
}
