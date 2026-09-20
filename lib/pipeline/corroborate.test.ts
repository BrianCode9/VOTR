import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_CORROBORATION_THRESHOLDS,
  claimsCorroborate,
  contentTokens,
  corroborationThresholdsFromEnv,
  countDistinctSources,
  distinctSourceKeys,
  findCorroborations,
  sourceKey,
  tokenOverlap,
  type CorroborationSubject,
} from "./corroborate"
import { normalizeSpeakerName, namesMatch, aliasSet } from "../speakers/normalize"

/**
 * Corroboration counting and its dedup rules.
 *
 * The number these produce is one a reader uses to decide how much to trust a
 * card, so the tests below are weighted toward the ways it could be inflated:
 * two articles from one outlet, a reprint, a claim about a different person,
 * a different kind of claim that happens to share words. Every one of those
 * must count as one source, not two.
 */

function subject(overrides: Partial<CorroborationSubject> = {}): CorroborationSubject {
  return {
    id: "a",
    cardType: "stance",
    topic: "housing",
    speakerId: "speaker-1",
    speakerName: "Maya Chen",
    headline: "Supports capping annual rent increases at three percent.",
    sourceKey: "demo gazette",
    documentId: "doc-1",
    ...overrides,
  }
}

describe("sourceKey", () => {
  test("two spellings of one outlet are one source", () => {
    assert.equal(sourceKey("The Demo Gazette"), sourceKey("Demo Gazette"))
    assert.equal(sourceKey("Demo Gazette "), "demo gazette")
  })

  test("falls back to the host, without the subdomain, when the name is empty", () => {
    assert.equal(sourceKey("", "https://www.npr.org/story/1"), "npr.org")
    assert.equal(sourceKey("  ", "https://text.npr.org/story/1"), "npr.org")
  })

  test("an unusable name and an unusable url land in one shared bucket", () => {
    // Deliberately NOT the document id. Per-document fallback keys would make
    // every nameless document its own "independent" source, which is exactly
    // the inflation this count must not have.
    assert.equal(sourceKey("", null), "unknown source")
    assert.equal(sourceKey("", "not a url"), "unknown source")
  })
})

describe("claimsCorroborate: the hard gates", () => {
  test("two outlets on the same position corroborate", () => {
    const verdict = claimsCorroborate(
      subject(),
      subject({
        id: "b",
        documentId: "doc-2",
        sourceKey: "riverside ledger",
        headline: "Backs a three percent cap on annual rent increases.",
      }),
    )
    assert.equal(verdict.corroborates, true)
  })

  test("two articles from the same outlet count once", () => {
    const verdict = claimsCorroborate(
      subject(),
      subject({ id: "b", documentId: "doc-2", sourceKey: "demo gazette" }),
    )
    assert.equal(verdict.corroborates, false)
    assert.match(verdict.reason, /same source/)
  })

  test("two insights in one document never corroborate", () => {
    const verdict = claimsCorroborate(
      subject(),
      // Same document, different source name: a document has one source, so
      // this can only happen if a source key was computed wrong. Rejected on
      // the document id as well, so one bad key cannot inflate a count.
      subject({ id: "b", documentId: "doc-1", sourceKey: "riverside ledger" }),
    )
    assert.equal(verdict.corroborates, false)
    assert.match(verdict.reason, /same document/)
  })

  test("an insight never corroborates itself", () => {
    assert.equal(claimsCorroborate(subject(), subject()).corroborates, false)
  })

  test("different speakers do not corroborate, however alike the words", () => {
    const verdict = claimsCorroborate(
      subject(),
      subject({
        id: "b",
        documentId: "doc-2",
        sourceKey: "riverside ledger",
        speakerId: "speaker-2",
        speakerName: "Daniel Okafor",
      }),
    )
    assert.equal(verdict.corroborates, false)
  })

  test("unattributed insights do not corroborate each other", () => {
    // With no speaker there is nothing to agree about, and treating them as
    // one anonymous person would make every unattributed claim on a topic
    // corroborate every other one.
    const anon = { speakerId: null, speakerName: null }
    const verdict = claimsCorroborate(
      subject(anon),
      subject({ ...anon, id: "b", documentId: "doc-2", sourceKey: "riverside ledger" }),
    )
    assert.equal(verdict.corroborates, false)
    assert.match(verdict.reason, /speaker/)
  })

  test("different topics do not corroborate", () => {
    const verdict = claimsCorroborate(
      subject(),
      subject({ id: "b", documentId: "doc-2", sourceKey: "riverside ledger", topic: "climate" }),
    )
    assert.equal(verdict.corroborates, false)
    assert.match(verdict.reason, /topic/)
  })

  test("a stance and a stance change on the same position do corroborate", () => {
    // Two outlets reporting one current position, one of which noticed it was
    // a change. Same claim, so the count should say two sources.
    const verdict = claimsCorroborate(
      subject(),
      subject({
        id: "b",
        cardType: "stance_change",
        documentId: "doc-2",
        sourceKey: "riverside ledger",
      }),
    )
    assert.equal(verdict.corroborates, true)
  })

  test("a factual claim does not corroborate a stance", () => {
    const verdict = claimsCorroborate(
      subject(),
      subject({
        id: "b",
        cardType: "factual_claim",
        documentId: "doc-2",
        sourceKey: "riverside ledger",
      }),
    )
    assert.equal(verdict.corroborates, false)
    assert.match(verdict.reason, /different kinds/)
  })

  test("unrelated positions on the same topic do not corroborate", () => {
    const verdict = claimsCorroborate(
      subject(),
      subject({
        id: "b",
        documentId: "doc-2",
        sourceKey: "riverside ledger",
        headline: "Wants the permit review office staffed with twelve more planners.",
      }),
    )
    assert.equal(verdict.corroborates, false)
    assert.match(verdict.reason, /not similar enough/)
  })

  test("an opposite position is not corroboration", () => {
    const verdict = claimsCorroborate(
      subject(),
      subject({
        id: "b",
        documentId: "doc-2",
        sourceKey: "riverside ledger",
        headline: "Opposes any cap on annual rent increases, favouring faster permitting.",
      }),
    )
    assert.equal(verdict.corroborates, false)
  })
})

describe("the two similarity rules", () => {
  test("a near-verbatim reprint matches on text similarity", () => {
    const verdict = claimsCorroborate(
      subject(),
      subject({
        id: "b",
        documentId: "doc-2",
        sourceKey: "riverside ledger",
        headline: "Supports capping annual rent increases at three percent",
      }),
    )
    assert.equal(verdict.corroborates, true)
    assert.match(verdict.reason, /text similarity/)
  })

  test("a paraphrase matches on token overlap, not edit distance", () => {
    const verdict = claimsCorroborate(
      subject({ headline: "Supports capping rent increases at 3%." }),
      subject({
        id: "b",
        documentId: "doc-2",
        sourceKey: "riverside ledger",
        headline: "Backs a three percent cap on rent increases.",
      }),
    )
    assert.equal(verdict.corroborates, true)
    assert.match(verdict.reason, /token overlap/)
  })

  test("numerals and their spelled-out forms are one token", () => {
    assert.ok(contentTokens("a three percent cap").includes("3"))
    assert.ok(contentTokens("a 3% cap").includes("3"))
  })

  test("a bare plural does not split a token", () => {
    assert.deepEqual(contentTokens("rent increases"), contentTokens("rent increase"))
  })

  test("token overlap is 1 for identical content and 0 for disjoint", () => {
    assert.equal(tokenOverlap("cap rent increases", "cap rent increases"), 1)
    assert.equal(tokenOverlap("cap rent increases", "expand bus routes"), 0)
  })

  test("very short claims are judged on text alone", () => {
    // Two two-word claims sharing one word score 0.5 on Dice, which is close
    // to the 0.6 bar on almost no evidence. Below minTokens the overlap rule
    // is skipped entirely rather than being allowed to decide.
    const verdict = claimsCorroborate(
      subject({ headline: "Supports vouchers" }),
      subject({
        id: "b",
        documentId: "doc-2",
        sourceKey: "riverside ledger",
        headline: "Opposes vouchers",
      }),
    )
    assert.equal(verdict.corroborates, false)
    assert.match(verdict.reason, /too few content words/)
  })
})

describe("counting", () => {
  const gazette = subject({ sourceKey: "demo gazette" })
  const ledger = subject({ id: "b", documentId: "doc-2", sourceKey: "riverside ledger" })
  const ledgerAgain = subject({ id: "c", documentId: "doc-3", sourceKey: "riverside ledger" })
  const radio = subject({ id: "d", documentId: "doc-4", sourceKey: "demo public radio" })

  test("an insight nothing has confirmed counts as one source, not zero", () => {
    // 1 is the floor because the insight itself came from somewhere. A 0 here
    // would make "one outlet" and "not yet scanned" indistinguishable.
    assert.equal(countDistinctSources(gazette, []), 1)
  })

  test("the count includes the insight's own source", () => {
    assert.equal(countDistinctSources(gazette, [ledger]), 2)
    assert.equal(countDistinctSources(gazette, [ledger, radio]), 3)
  })

  test("two documents from one outlet count once", () => {
    assert.equal(countDistinctSources(gazette, [ledger, ledgerAgain]), 2)
  })

  test("a match from the insight's own outlet cannot raise the count", () => {
    const sameOutlet = subject({ id: "e", documentId: "doc-5", sourceKey: "demo gazette" })
    assert.equal(countDistinctSources(gazette, [sameOutlet]), 1)
  })

  test("the source list leads with the insight's own outlet", () => {
    // Part of the contract: a client rendering "Gazette and 2 others" reads
    // the first entry as the card's own source.
    assert.deepEqual(distinctSourceKeys(gazette, [radio, ledger]), [
      "demo gazette",
      "demo public radio",
      "riverside ledger",
    ])
  })
})

describe("findCorroborations", () => {
  test("judges each unordered pair once", () => {
    const pairs = findCorroborations([
      subject({ id: "a", sourceKey: "demo gazette", documentId: "doc-1" }),
      subject({ id: "b", sourceKey: "riverside ledger", documentId: "doc-2" }),
      subject({ id: "c", sourceKey: "demo public radio", documentId: "doc-3" }),
    ])

    // Three mutually corroborating insights are three pairs, not six.
    assert.equal(pairs.length, 3)
  })

  test("a set that shares one outlet produces fewer pairs", () => {
    const pairs = findCorroborations([
      subject({ id: "a", sourceKey: "demo gazette", documentId: "doc-1" }),
      subject({ id: "b", sourceKey: "demo gazette", documentId: "doc-2" }),
      subject({ id: "c", sourceKey: "riverside ledger", documentId: "doc-3" }),
    ])

    // a-b is rejected as the same outlet; a-c and b-c stand.
    assert.equal(pairs.length, 2)
  })
})

describe("corroborationThresholdsFromEnv", () => {
  test("nothing set means the defaults", () => {
    assert.deepEqual(corroborationThresholdsFromEnv({}), DEFAULT_CORROBORATION_THRESHOLDS)
  })

  test("a present but empty value does not become zero", () => {
    // A threshold of 0 would make every pair of insights on one topic
    // corroborate, which would make the number on the card meaningless.
    assert.deepEqual(
      corroborationThresholdsFromEnv({
        CORROBORATION_TEXT_SIMILARITY: "",
        CORROBORATION_TOKEN_OVERLAP: "0",
      }),
      DEFAULT_CORROBORATION_THRESHOLDS,
    )
  })

  test("valid values are applied", () => {
    const thresholds = corroborationThresholdsFromEnv({
      CORROBORATION_TEXT_SIMILARITY: "0.95",
      CORROBORATION_TOKEN_OVERLAP: "0.75",
    })
    assert.equal(thresholds.textSimilarity, 0.95)
    assert.equal(thresholds.tokenOverlap, 0.75)
  })
})

/**
 * Speaker identity, which corroboration and the timeline both rest on.
 *
 * Two people merged into one is worse than one person kept in two halves: the
 * first puts words in someone's mouth, the second shows less history. The
 * matching rules are built to fail in the second direction.
 */
describe("speaker normalization", () => {
  test("a title does not make a second person", () => {
    assert.equal(normalizeSpeakerName("Rep. Maya Chen"), "maya chen")
    assert.equal(normalizeSpeakerName("Representative Maya Chen"), "maya chen")
    assert.equal(normalizeSpeakerName("  MAYA  CHEN "), "maya chen")
  })

  test("stacked titles all come off", () => {
    assert.equal(normalizeSpeakerName("State Rep. Dr. Maya Chen"), "maya chen")
  })

  test("a suffix does not make a second person", () => {
    assert.equal(normalizeSpeakerName("Daniel Okafor Jr."), "daniel okafor")
  })

  test("a middle name matches the two-part form", () => {
    assert.equal(namesMatch("Maya Chen", "Maya Ling Chen"), true)
    assert.equal(namesMatch("Rep. Maya Chen", "Maya Ling Chen"), true)
  })

  test("names one edit apart are two people", () => {
    // Deliberately not a fuzzy distance. Merging two politicians is the
    // damaging direction to be wrong in.
    assert.equal(namesMatch("Maya Chen", "Maya Chan"), false)
    assert.equal(namesMatch("Daniel Okafor", "Danielle Okafor"), false)
  })

  test("a surname alone matches nobody", () => {
    assert.equal(namesMatch("Chen", "Maya Chen"), false)
  })

  test("a bare title is not a person", () => {
    // Anything that normalizes to an empty string is refused by
    // resolveSpeaker rather than being made into a row. Without this, a
    // document that says only "the Mayor" would mint a speaker called "mayor"
    // and every later unattributed "Mayor" would resolve to that fiction.
    assert.equal(normalizeSpeakerName("Mayor"), "")
    assert.equal(normalizeSpeakerName("Rep."), "")
    assert.equal(normalizeSpeakerName("Councilmember"), "")
    assert.equal(normalizeSpeakerName("   "), "")
    assert.equal(namesMatch("Mayor", "Mayor Priya Reyes"), false)
  })

  test("the alias set is normalized and de-duplicated", () => {
    assert.deepEqual(
      aliasSet(["Rep. Maya Chen", "Maya Chen", "  ", "Representative Maya Chen"]),
      ["maya chen"],
    )
  })
})
