# VOTR

A civic app for young voters. Enter an address, get every race on your ballot, with each candidate's positions reconstructed from what they have actually said on the record. Every insight carries the exact quote, the source, and a one-tap link back to the original.

Full product spec lives in `docs/VOTR-spec.md`. Read it before starting anything structural.

---

## The one rule that overrides everything

**Nothing renders in the user interface unless its quote has been verified by exact match against stored source text.**

If you are ever weighing "ship it with a paraphrase" against "do not ship it," the answer is do not ship it. The product's entire value proposition is that every claim is traceable. One untraceable card undermines the whole thing.

Do not:
- Store a quote as a string and render that string
- Let a model paraphrase and call it a quote
- Soften a failed verification into "approximate" or "paraphrased"
- Render an insight whose source document is missing or whose offsets do not resolve

Do:
- Store `quote_char_start` and `quote_char_end` integers against a stored `raw_text`
- Render quotes by slicing the raw document at those offsets
- Discard or hard-flag anything that fails to match

---

## Stack

- Next.js (App Router) + TypeScript, single repo
- Tailwind + shadcn/ui
- Postgres (Neon or Supabase) with Drizzle Object Relational Mapper (ORM)
- Zod for all schemas
- Anthropic Application Programming Interface (API) with tool use for extraction
- NVIDIA Nemotron for routing, judging, and classification
- ElevenLabs Scribe for transcription, text to speech for briefings
- Motion for gestures, Vaul for sheets, Lenis for smooth scroll, Sonner for toasts, Recharts for the eval chart
- Deploy on Vercel

Do not add: Prisma, a job queue, pgvector, an authentication provider, a separate backend service, a carousel library, a state management library beyond React built-ins plus URL state.

---

## Conventions

**Schemas.** Every data shape is defined once in Zod under `lib/schemas/`. Derive TypeScript types with `z.infer`. Derive the Large Language Model (LLM) tool definition with `zodToJsonSchema`. Never hand-write a type that duplicates a Zod schema.

**Database.** Drizzle schema in `db/schema.ts`. No raw Structured Query Language (SQL) except where a query genuinely needs it, and comment why when you do.

**Server work.** Prefer server components reading the database directly. Only create an API route when something external calls it (ingestion triggers, cron, webhooks) or the client genuinely needs to mutate.

**Errors.** Every external call (fetch, LLM, transcription) wraps in a typed result rather than throwing. The ingestion pipeline must survive a single bad document without dying.

**No em dashes in any user-facing copy.**

---

## Repo layout

```
app/                    routes, server components
  api/ingest/           ingestion trigger
components/             shadcn plus app components
db/schema.ts            Drizzle schema
lib/
  schemas/              Zod, single source of truth
  adapters/             one file per source
    types.ts            the normalized Document interface
    rss.ts
    gdelt.ts
    transcript.ts
  extract/
    prompt.ts
    verify.ts           the quote verification ladder
  nemotron/
    triage.ts
    judge.ts
    classify.ts
  eval/                 judge eval harness and fixtures
docs/VOTR-spec.md
```

---

## The pipeline, in order

1. **Adapter** fetches a document, normalizes it to the `Document` shape, stores it with full `raw_text`.
2. **Nemotron triage** decides whether this document concerns a tracked candidate and which issues it touches. Most documents get dropped here. Do not skip this, the volume from GDELT is too high otherwise.
3. **Extraction** (Anthropic, tool use) produces candidate insights: position, quote, issue tag, plain-language rewrite, self-rated confidence.
4. **Verification** runs the ladder in `lib/extract/verify.ts`. Exact match, then normalized match, then discard. Success stores offsets.
5. **Nemotron judge** receives only the verified quote and the claimed position. No extractor reasoning, no article context, no candidate name. Returns 0 to 3.
6. **Routing.** 3 or 2 publishes. 1 publishes with a "verify yourself" nudge. 0 is rejected and logged to the public failure table.
7. **Change detection** is a separate pass over (candidate, issue) pairs. Never fold it into step 3; the extractor has no prior context and will hallucinate history.

---

## The verification ladder

Implement exactly this in `lib/extract/verify.ts`:

```
1. Exact substring match of quote against document.raw_text
2. If fail: normalize both sides and retry
     collapse whitespace
     unify quote characters (curly to straight)
     unify dash characters
     strip Hypertext Markup Language (HTML) entities
3. If fail AND document.media_type === 'transcript':
     additionally strip filler words, collapse repeated words
4. If fail: return { ok: false }, log to rejections table
5. If success: return offsets into the ORIGINAL raw_text, not the normalized copy
```

Step 5 is the part that gets broken. If you normalize and then compute offsets, the offsets point into a string that no longer exists. Map back to the original.

Transcripts additionally store `timestamp_start` and `timestamp_end` so "see original" opens the video at the moment.

---

## Nemotron: what it is for

It is not a chat surface. It occupies three decision points:

- **Router.** Triage every incoming document before paying for extraction.
- **Judge.** Independently verify that a quote supports its claimed position. This is load-bearing. It must never see the extractor's output beyond the quote and the claim, because independence is the entire reason it exists.
- **Classifier.** Attribution (own words vs. characterization), flag assignment, comment moderation.

There is an eval harness in `lib/eval/`. It must produce three arms: no judge, extractor self-grading, and Nemotron judge, measured on a 100 item set that includes deliberately corrupted pairs (position swap, qualifier truncation, negation drop). This is a submission requirement, not a stretch goal.

---

## Design system

The look is grounded in the artifact the product is built on: **the annotated record.** A transcript with a timecode. A document with a passage highlighted. A citation pointing at a line. Every visual motif is functional. The timecode is a real timestamp. The highlight marks the actual verified span.

**The signature element is the highlight.** Quotes appear highlighted, the way you mark a passage you are about to cite.

### Two modes

| Mode | Surface | Treatment |
|---|---|---|
| Consumption | The feed | Dark, full-bleed, cinematic |
| Verification | Source view, document view, source tab | Light. Paper. Full document with the cited span highlighted in place. |

"See original" moves dark to light. That transition is the thesis in one gesture. Do not make both modes look the same.

### Tokens

```css
--ink:        #131820;  /* dark field, blue-slate not flat black */
--ink-raised: #1C222C;
--paper:      #F1EFE9;  /* verification surfaces */
--paper-line: #DCD8CE;

--mark:       #F2E85C;  /* highlighter, verified spans ONLY */
--stamp:      #C5342B;  /* flags ONLY */

--text-hi:    #FAF9F6;
--text-lo:    #8E96A3;
```

`--mark` never decorates. If something is highlighted, it is a verified span. `--stamp` appears only on a flag. That discipline is what makes the color carry meaning.

Never pure `#000` or `#FFF`.

### Type

- **Archivo** (variable, Google Fonts) for quotes and headlines. Tight grotesque, set large, slightly condensed. Reads as signage and broadcast chyron.
- **Martian Mono** for timecodes, source attribution, dates, counts. Small and sparing, never body copy.

### Motion

One orchestrated moment: **the highlight sweep.** As a card enters, the mark sweeps left to right across the quote. Nothing else animates on entry.

Everything else responds to a user action: sheet opening, save confirming, mode switching. Respect `prefers-reduced-motion` by rendering the highlight already complete.

### Do not

- High-contrast serif display on a cream field
- All-caps tracked-out eyebrow labels above headings
- An arrow appended to every button
- Identical rounded cards with the same grey shadow on everything
- Fade-and-slide-up entrances on every section
- Gradient washes as decoration

These are the current defaults of generated pages. They will make the work look automated, which for this product is fatal.

### Quality floor

Mobile first, because the feed is a phone product. Visible keyboard focus. Reduced motion respected. Contrast checked, especially dark text on `--mark`.

Copy is sentence case, active voice, plain verbs. Empty states say what to do next. Errors say what went wrong and how to fix it. Nothing apologizes.

---

## Feed behavior

- Full-bleed, one insight per viewport, CSS `scroll-snap-type: y mandatory`. No carousel library.
- Quote is the hero. Position in plain language is secondary. Source and attribution small at the bottom.
- Preload the next three cards. Any loading state between items kills the feel.
- Flag badges (`FLIP-FLOP`, `NEW`, `UNVERIFIED CLAIM`) rank high at the start of a session, then settle into the user's issue tags.
- Video clip cards autoplay muted with burned-in captions, clipped to the Scribe timestamp range.
- **No infinite feed.** Runs are finite and end on an action: register, check polling place, export ballot.

---

## Interface rules

- Comments attach to an `insight_id`, never to a candidate. One level of replies, no deep nesting.
- Reactions are helpful / not helpful / changed my mind / looks wrong. There is no agree or disagree with the politician anywhere in the app.
- "Looks wrong" never shows a public count.
- Every card has a tappable "why am I seeing this."
- Synthetic documents render a visible badge. Enforce this in the card component itself so it cannot be forgotten at the data layer.
- No login anywhere. `session_id` in local storage carries reactions and comments.

---

## When data is thin

Most local candidates will have very few sources. Show that honestly: source counts, date ranges, and an explicit "has not commented on this issue" state. Do not fill a sparse profile with confident-looking layout. Thinness shown is useful information; thinness hidden is a lie.

---

## Before you build something big

If a task touches the verification path, the judge, or the data model, say what you are about to do and why before writing code. Everything else, just build it.
