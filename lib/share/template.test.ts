import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { escapeXml, flagLabel, svgShareRenderer, wrapText, type ShareCardData } from "./template"

/**
 * The share card renderer.
 *
 * A share card is the one artifact of this app that travels without its
 * context: it gets screenshotted and passed on, and nobody who sees it can
 * click through to check. So the things worth testing are that it always
 * carries a quote, that it never breaks its own markup, and that hostile text
 * in a document cannot become markup in the card.
 */

function card(overrides: Partial<ShareCardData> = {}): ShareCardData {
  return {
    insightId: "00000000-0000-4000-8000-000000000001",
    plainLanguageSummary: "She wants to limit rent increases to three percent next year.",
    plainLanguage: "She wants to limit how much rents can go up.",
    quote: "We will cap rent increases at three percent next year",
    sourceName: "Example Herald",
    candidateName: "Mayor Chen",
    flags: ["NEW", "FLIP_FLOP"],
    issueTag: "housing",
    ...overrides,
  }
}

describe("escapeXml", () => {
  test("neutralizes every character that can break out of markup", () => {
    assert.equal(
      escapeXml(`<script>&"'`),
      "&lt;script&gt;&amp;&quot;&apos;",
    )
  })
})

describe("wrapText", () => {
  test("breaks on word boundaries within the column", () => {
    const lines = wrapText("one two three four five", 9, 5)
    assert.ok(lines.every((l) => l.length <= 9), `a line ran over: ${JSON.stringify(lines)}`)
  })

  test("never returns more lines than the card has room for", () => {
    const lines = wrapText("word ".repeat(200), 20, 4)
    assert.ok(lines.length <= 4)
  })

  test("marks truncation so the reader knows text was cut", () => {
    const lines = wrapText("word ".repeat(200), 20, 3)
    assert.ok(lines[lines.length - 1].endsWith("…"))
  })

  test("does not mark text that fit", () => {
    const lines = wrapText("short enough", 40, 3)
    assert.deepEqual(lines, ["short enough"])
  })

  test("a single over-long word is still bounded", () => {
    const lines = wrapText("x".repeat(500), 20, 2)
    assert.ok(lines.length <= 2)
  })

  test("empty input produces no lines rather than a blank one", () => {
    assert.deepEqual(wrapText("   ", 20, 3), [])
  })
})

describe("the SVG renderer", () => {
  test("renders well-formed SVG at a fixed size", async () => {
    const rendered = await svgShareRenderer.render(card())

    assert.equal(rendered.contentType, "image/svg+xml")
    assert.equal(rendered.encoding, "utf8")
    assert.equal(rendered.width, 1200)
    assert.equal(rendered.height, 630)
    assert.ok(rendered.body.startsWith("<svg"))
    assert.ok(rendered.body.trimEnd().endsWith("</svg>"))
  })

  test("shows the plain-language summary and the quote together", async () => {
    const { body } = await svgShareRenderer.render(card())
    assert.ok(body.includes("limit rent increases"))
    assert.ok(body.includes("cap rent increases"))
  })

  test("falls back to the extractor's line when there is no rewrite", async () => {
    // The rewrite is allowed to fail, and a card with no headline would be the
    // failure leaking all the way to the thing people share.
    const { body } = await svgShareRenderer.render(card({ plainLanguageSummary: null }))
    assert.ok(body.includes("how much rents can go up"))
  })

  test("shows every flag the insight carries", async () => {
    const { body } = await svgShareRenderer.render(card())
    assert.ok(body.includes("NEW"))
    assert.ok(body.includes("CHANGED POSITION"))
  })

  test("renders with no flags at all", async () => {
    const { body } = await svgShareRenderer.render(card({ flags: [] }))
    assert.ok(body.startsWith("<svg"))
  })

  test("renders with no named speaker", async () => {
    const { body } = await svgShareRenderer.render(card({ candidateName: null }))
    assert.ok(body.includes("Example Herald"))
  })

  test("markup in the source document cannot become markup in the card", async () => {
    // The quote is copied verbatim out of a web page, so this is not a
    // hypothetical: an article containing a tag must not produce one here.
    const { body } = await svgShareRenderer.render(
      card({
        quote: '</text><script>alert(1)</script>',
        candidateName: '"><script>alert(2)</script>',
        plainLanguageSummary: "Sneaky <b>markup</b> & entities",
      }),
    )

    assert.ok(!body.includes("<script>"), "raw script tag reached the output")
    assert.ok(!body.includes("</text><text"), "the quote closed its own element")
    assert.ok(body.includes("&lt;script&gt;"))
  })

  test("a very long quote does not overflow the card", async () => {
    const { body } = await svgShareRenderer.render(
      card({ quote: "The council will review the proposal ".repeat(60) }),
    )

    // Four quote lines plus the headline lines, and nothing else.
    const quoteLines = [...body.matchAll(/class="quote"/g)].length
    assert.ok(quoteLines <= 4, `${quoteLines} quote lines rendered`)
  })

  test("the template id is stable, because it is the cache key", async () => {
    // A change to the artwork must come with a change here, or every cached
    // card in the database keeps serving the old design.
    assert.equal(svgShareRenderer.template, "svg-v1")
  })
})

describe("flagLabel", () => {
  test("uses words a reader understands, not the enum", () => {
    assert.equal(flagLabel("FLIP_FLOP"), "CHANGED POSITION")
    assert.equal(flagLabel("UNVERIFIED_CLAIM"), "UNVERIFIED CLAIM")
    assert.equal(flagLabel("NEW"), "NEW")
  })
})
