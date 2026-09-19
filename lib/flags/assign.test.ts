import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  assignFlags,
  flagOptionsFromEnv,
  positionsDiffer,
  primaryFlag,
  DEFAULT_FLIP_FLOP_CONFIDENCE,
  type FlagSubject,
} from "./assign"
import { checkClaim, registerFactCheckProvider, unresolvedProvider } from "./fact-check"
import { INSIGHT_FLAGS, isInsightFlag } from "./types"

/**
 * The flag rules, exhaustively.
 *
 * assignFlags is pure, so every branch is reachable from a literal. The
 * database fact it depends on - whether this speaker has been on record about
 * this topic - arrives as a boolean, which is exactly why the rules were
 * written to take one.
 */

function subject(overrides: Partial<FlagSubject> = {}): FlagSubject {
  return {
    cardType: "stance",
    payload: { cardType: "stance" },
    headline: "Supports capping rent increases at three percent.",
    confidence: 0.9,
    candidateName: "Mayor Chen",
    hasPriorHistory: true,
    factCheckStatus: "unresolved",
    ...overrides,
  }
}

function stanceChange(overrides: Partial<FlagSubject> = {}): FlagSubject {
  return subject({
    cardType: "stance_change",
    payload: {
      cardType: "stance_change",
      previousPosition: "Opposed any cap on rent increases.",
      priorInsightId: null,
    },
    headline: "Supports capping rent increases at three percent.",
    ...overrides,
  })
}

function claim(overrides: Partial<FlagSubject> = {}): FlagSubject {
  return subject({
    cardType: "factual_claim",
    payload: { cardType: "factual_claim", checkability: "easily_checkable" },
    headline: "The city lost 4,000 affordable units since 2024.",
    ...overrides,
  })
}

describe("NEW", () => {
  test("the first insight for a speaker and topic is NEW", () => {
    assert.deepEqual(assignFlags(subject({ hasPriorHistory: false })), ["NEW"])
  })

  test("a speaker already on record about this topic is not NEW", () => {
    assert.deepEqual(assignFlags(subject({ hasPriorHistory: true })), [])
  })

  test("an unattributed insight is never NEW, even with no history", () => {
    // There is no speaker+topic pair to be first for. Treating every
    // unattributed card as one anonymous speaker would make the first one in
    // the database NEW and no later one ever.
    assert.deepEqual(
      assignFlags(subject({ candidateName: null, hasPriorHistory: false })),
      [],
    )
  })

  test("NEW applies to every card type, not only stances", () => {
    assert.ok(
      assignFlags(claim({ hasPriorHistory: false })).includes("NEW"),
      "a first-ever factual claim about a topic is still new information",
    )
  })
})

describe("FLIP_FLOP", () => {
  test("a confident, substantive stance change is flagged", () => {
    assert.ok(assignFlags(stanceChange({ confidence: 0.9 })).includes("FLIP_FLOP"))
  })

  test("below the confidence threshold it is not flagged", () => {
    // The card still exists and is still shown. It just does not get the
    // loudest label in the app attached to it on a weak signal.
    assert.ok(!assignFlags(stanceChange({ confidence: 0.5 })).includes("FLIP_FLOP"))
  })

  test("exactly at the threshold it is flagged", () => {
    const flags = assignFlags(stanceChange({ confidence: DEFAULT_FLIP_FLOP_CONFIDENCE }))
    assert.ok(flags.includes("FLIP_FLOP"))
  })

  test("the threshold is configurable", () => {
    const item = stanceChange({ confidence: 0.55 })
    assert.ok(!assignFlags(item).includes("FLIP_FLOP"))
    assert.ok(assignFlags(item, { flipFlopConfidence: 0.5 }).includes("FLIP_FLOP"))
  })

  test("a reworded identical position is not a flip-flop", () => {
    const flags = assignFlags(
      stanceChange({
        payload: {
          cardType: "stance_change",
          previousPosition: "We will cap rent increases at 3%.",
          priorInsightId: null,
        },
        headline: "we will cap rent increases at 3 percent",
      }),
    )
    assert.ok(!flags.includes("FLIP_FLOP"))
  })

  test("a missing previous position withholds the flag rather than awarding it", () => {
    const flags = assignFlags(
      stanceChange({
        payload: { cardType: "stance_change", previousPosition: "", priorInsightId: null },
      }),
    )
    assert.ok(!flags.includes("FLIP_FLOP"))
  })

  test("only a stance_change card can be a flip-flop", () => {
    // The model cannot decide to call something a flip-flop: the badge follows
    // from a card type that only exists when documented history was supplied.
    assert.ok(!assignFlags(subject({ confidence: 1 })).includes("FLIP_FLOP"))
    assert.ok(!assignFlags(claim({ confidence: 1 })).includes("FLIP_FLOP"))
  })
})

describe("positionsDiffer", () => {
  test("case and punctuation are not a change of position", () => {
    assert.equal(positionsDiffer("We will cap rents.", "we will cap rents"), false)
  })

  test("a reversal is a change of position", () => {
    assert.equal(positionsDiffer("Opposes a rent cap", "Supports a rent cap"), true)
  })

  test("either side missing means it cannot tell, so it says no", () => {
    assert.equal(positionsDiffer(null, "Supports a rent cap"), false)
    assert.equal(positionsDiffer("Supports a rent cap", ""), false)
    assert.equal(positionsDiffer(undefined, undefined), false)
  })
})

describe("UNVERIFIED_CLAIM", () => {
  test("an easily checkable claim nobody has checked still carries it", () => {
    // With no fact-check provider wired up this is every factual claim, which
    // is the honest state of the system.
    const flags = assignFlags(claim({ factCheckStatus: "unresolved" }))
    assert.ok(flags.includes("UNVERIFIED_CLAIM"))
  })

  test("a resolved, easily checkable claim loses the badge", () => {
    const flags = assignFlags(claim({ factCheckStatus: "supported" }))
    assert.ok(!flags.includes("UNVERIFIED_CLAIM"))
  })

  test("a claim checked and found false is no longer unverified", () => {
    // Deliberate: "unverified" and "disproven" are different statements, and
    // saying the second one needs its own badge rather than this one.
    const flags = assignFlags(claim({ factCheckStatus: "false" }))
    assert.ok(!flags.includes("UNVERIFIED_CLAIM"))
  })

  test("a claim needing expertise carries it however it was checked", () => {
    for (const status of ["unresolved", "supported", "disputed", "false"] as const) {
      const flags = assignFlags(
        claim({
          payload: { cardType: "factual_claim", checkability: "requires_expertise" },
          factCheckStatus: status,
        }),
      )
      assert.ok(flags.includes("UNVERIFIED_CLAIM"), `checkability beat status ${status}`)
    }
  })

  test("an unverifiable claim carries it", () => {
    const flags = assignFlags(
      claim({
        payload: { cardType: "factual_claim", checkability: "unverifiable" },
        factCheckStatus: "supported",
      }),
    )
    assert.ok(flags.includes("UNVERIFIED_CLAIM"))
  })

  test("only factual claims carry it", () => {
    assert.ok(!assignFlags(subject()).includes("UNVERIFIED_CLAIM"))
    assert.ok(!assignFlags(stanceChange()).includes("UNVERIFIED_CLAIM"))
  })
})

describe("several flags at once", () => {
  test("a first-ever stance change is both NEW and FLIP_FLOP", () => {
    assert.deepEqual(assignFlags(stanceChange({ hasPriorHistory: false })), [
      "NEW",
      "FLIP_FLOP",
    ])
  })

  test("a first-ever unchecked claim is both NEW and UNVERIFIED_CLAIM", () => {
    assert.deepEqual(assignFlags(claim({ hasPriorHistory: false })), [
      "NEW",
      "UNVERIFIED_CLAIM",
    ])
  })

  test("an ordinary stance from a known speaker carries nothing", () => {
    assert.deepEqual(assignFlags(subject()), [])
  })

  test("flags come back in a stable order", () => {
    // So two rows with the same badges compare equal as arrays, and so
    // flags[0] is a predictable value for the legacy column to mirror.
    const flags = assignFlags(claim({ hasPriorHistory: false }))
    const positions = flags.map((f) => INSIGHT_FLAGS.indexOf(f))
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b))
  })

  test("every value returned is a known flag", () => {
    const all = [
      assignFlags(stanceChange({ hasPriorHistory: false })),
      assignFlags(claim({ hasPriorHistory: false })),
      assignFlags(subject({ hasPriorHistory: false })),
    ].flat()
    assert.ok(all.every(isInsightFlag))
  })
})

describe("primaryFlag", () => {
  test("mirrors the first flag for the legacy column", () => {
    assert.equal(primaryFlag(assignFlags(stanceChange({ hasPriorHistory: false }))), "NEW")
    assert.equal(primaryFlag(assignFlags(stanceChange())), "FLIP_FLOP")
    assert.equal(primaryFlag([]), null)
  })
})

describe("flagOptionsFromEnv", () => {
  test("defaults when unset", () => {
    assert.equal(
      flagOptionsFromEnv({}).flipFlopConfidence,
      DEFAULT_FLIP_FLOP_CONFIDENCE,
    )
  })

  test("reads a valid override", () => {
    assert.equal(
      flagOptionsFromEnv({ FLIP_FLOP_CONFIDENCE_THRESHOLD: "0.85" }).flipFlopConfidence,
      0.85,
    )
  })

  test("falls back rather than trusting nonsense", () => {
    for (const raw of ["", "high", "-1", "2", "NaN"]) {
      assert.equal(
        flagOptionsFromEnv({ FLIP_FLOP_CONFIDENCE_THRESHOLD: raw }).flipFlopConfidence,
        DEFAULT_FLIP_FLOP_CONFIDENCE,
        `"${raw}" should not have been accepted`,
      )
    }
  })
})

describe("the fact-check seam", () => {
  test("the default provider resolves nothing", async () => {
    const verdict = await checkClaim("The city lost 4,000 units.")
    assert.equal(verdict.status, "unresolved")
  })

  test("a provider that throws is an unresolved verdict, not an exception", async () => {
    const verdict = await checkClaim("anything", {
      provider: {
        name: "broken",
        async check() {
          throw new Error("upstream is down")
        },
      },
    })
    // A fact-check outage must never be able to stop an insight being stored.
    assert.equal(verdict.status, "unresolved")
    assert.equal(verdict.source, "broken")
  })

  test("a provider that hangs is an unresolved verdict", async () => {
    const verdict = await checkClaim("anything", {
      provider: {
        name: "slow",
        check: () => new Promise(() => {}),
      },
      timeoutMs: 20,
    })
    assert.equal(verdict.status, "unresolved")
  })

  test("a real verdict comes through and changes the badge", async () => {
    const previous = registerFactCheckProvider({
      name: "test-checker",
      async check() {
        return { status: "supported" as const, source: "test-checker" }
      },
    })

    try {
      const verdict = await checkClaim("The city lost 4,000 units.")
      assert.equal(verdict.status, "supported")

      const flags = assignFlags(claim({ factCheckStatus: verdict.status }))
      assert.ok(!flags.includes("UNVERIFIED_CLAIM"))
    } finally {
      registerFactCheckProvider(previous)
    }
  })

  test("the registry restores cleanly", async () => {
    assert.equal((await checkClaim("x")).source, unresolvedProvider.name)
  })
})
