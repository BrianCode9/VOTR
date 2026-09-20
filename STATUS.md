# Status

Against the build order in `docs/VOTR-spec.md` section 13. Last updated 2026-09-19.

The API contract the frontend is being built against is `docs/openapi.yaml`,
and the enums it branches on are explained in the README. Both are the
deliverable, not a by-product: a teammate is building against this surface
while it moves, so inside `/api/v1` changes are additive only.

## Build order

| # | Step | State |
|---|---|---|
| 1 | Document ingestion (RSS and GDELT) into Postgres with raw text | **done** |
| 2 | Nemotron triage router | **blocked** - NVIDIA key invalid |
| 3 | Extraction with Zod-validated tool use | **done** |
| 4 | Quote verification with character offsets | **done** |
| 5 | Nemotron verification judge plus routing | **blocked** - NVIDIA key invalid |
| 6 | Card feed from verified insights, tokens and type in place | **done** |
| 7 | Address to district resolution | **done** - Census geocoder, no API key |
| 8 | Voting mechanics tab | not started |
| 9 | Source tab and "why am I seeing this" | **partial** - why-am-I-seeing-this ships on the card; `/api/v1/insights/:id/source` returns everything the tab needs, no UI yet |
| 10 | Scribe transcription and timestamp jump | not started - ELEVENLABS_API_KEY empty |
| 11 | Change detection second pass | not started |
| 12 | Reactions, then comments with moderation | not started - tables exist, no code |
| 13 | Judge eval, three arms, one chart | **blocked** - NVIDIA key invalid |
| 14 | Audio briefing | not started |
| 15 | Compare view, share image, timeline, add-a-source | **partial** - share image done; timeline API done (`/api/v1/speakers/:id/timeline`); compare view and add-a-source not started |
| 16 | Conversational agent | not started |

## The reader's flow

The site is four routes and one question. Every call to action on every
surface leads into this and nowhere else; before the refactor, fourteen of the
sixteen CTAs were fragment links to other sections of the landing page.

| Route | What it is |
|---|---|
| `/` | Asks where you vote. The form is the hero, not section eight. |
| `/ballot/[state]?district=N` | Your races, your candidates. The dashboard. |
| `/candidate/[id]` | One person, their verified quotes, their certified filing. |
| `/ballot/[state]/topic/[slug]` | One issue across your whole ballot. |

`/feed` still serves every verified insight and is reachable from the footer.
It is no longer a competing entry point.

Location lives in the `votr_location` cookie (`CA`, or `TX-7`), so the promise
that it works without an account is literally true. `user_profiles` stays the
home for an account-backed profile when there is an account to back it.

The form posts to a Server Action and works with JavaScript disabled: the state
select is the floor, the address is the refinement, and no path through it ends
without a ballot.

## Setup

| Item | State |
|---|---|
| Next.js 16 / React 19 / Tailwind v4 / shadcn | done |
| Neon Postgres, 9 tables migrated to `production` | done |
| Neon CLI linked, MCP registered, skills installed | done |
| `.neon` committed so teammates resolve the project on clone | done |
| README with setup, DB model, onboarding block | done |
| Node 24 via nvm-windows | done |
| `ANTHROPIC_API_KEY` | working, verified live |
| `NVIDIA_API_KEY` | **invalid** - returns 401 on inference |
| `ELEVENLABS_API_KEY` | empty |

## What is in the database

6 documents from a live NPR feed, 44 verified insights, 0 rejections.
1 demo district, 1 demo race, candidates created by name from extraction.

## Commands

```bash
npm run dev          # feed at localhost:3000
npm run ingest       # pull an RSS feed into documents
npm run persist      # extract + verify + store insights
npm run seed:demo    # demo fixtures, no model call, for frontend work
npm run backfill     # one-time after migration 0003
npm run corroborate  # recompute source-diversity counts
npm test             # 208 tests, no database or API key needed
```

## Known gaps, deliberate

**`judge_rating` is null on all 44 insights** and status is `published`. That is
not the real routing from spec section 3. The judge pass re-routes these rows
once step 5 can run.

**Most insights are tagged `other`.** The issue enum in `lib/schemas/insight.ts`
has no press-freedom tag and the current documents are mostly about press
access. Two-line fix, left open because it is a product taxonomy call.

**Candidate resolution is by name only**, into one demo race, for rows written
by extraction. The ballot surfaces do not read those: `lib/queries/ballot.ts`
inner-joins `candidate_sources`, so only certified filings appear and the demo
district is excluded by geo_id. Address to district resolution (step 7) is
done, and lives in `lib/location/`.

**Verified quotes exist for CA and MD only.** Every state draws a correct
ballot from 4,496 certified filings, but a reader outside those two sees
"Nothing on the record yet" on every candidate. That is the honest state and
the pages say so plainly rather than hiding the candidate. Closing it is an
ingest run, not a frontend change.

**Repeated phrases are not collapsed** by the verification ladder, only repeated
words, per the spec wording. A transcript stutter like "we will we will" fails
verification rather than risking a match the speaker never said contiguously.

**`zod-to-json-schema` is installed but unused.** Zod 4 has native
`z.toJSONSchema`, which is what `lib/schemas/tool-schema.ts` uses. `CLAUDE.md`
still names the package.

**Migration 0003 needs two commands after it, not one.** It deliberately does
not populate `speakers` or compute corroboration, because both are TypeScript
rules that a SQL translation would drift from. After `npm run db:migrate`, run
`npm run backfill`. Until then every insight reads as one source with no
speaker, which is the honest pre-scan state, not a broken one.

**The 44 existing insights have no real `claim_support_confidence`.** The
migration copied `extractor_confidence` into it for `stance` rows only, where
the two are genuinely the same quantity, and left the other card types null
with a label derived from the approximation. Re-running `npm run persist` over
those documents replaces the approximation with a real rating; the fixtures
from `npm run seed:demo` have real ones throughout.

**`insights.verify_yourself` (column) and `insight_status.verify_yourself`
(enum value) are different things.** The status routes a row away from the feed
entirely. The column is about how a published row is worded. Nothing in the
code confuses them, but the names invite it.

## Rules that are enforced in code, not convention

- `insights.quote_char_start/end` are NOT NULL, so a failed verification cannot
  exist as a half-record.
- `comments.moderation_status` defaults to `hold`, so an unmoderated comment
  cannot leak into a read.
- The synthetic-document badge lives in `InsightCard`, not the data layer.
- `presentation_mode` is stored, not derived by a client. Moving a confidence
  threshold then changes every surface at once, and two clients cannot disagree
  about where the line between "said" and "check this yourself" sits.
- `corroboration_count` has a floor of 1 and counts distinct SOURCES, not
  documents. Two articles from one outlet are one outlet, and there is no 0, so
  "one source" and "not yet scanned" cannot be confused.
- Fixture quotes are declared as strings and located with `indexOf` at seed
  time. There are no hand-written offsets in `lib/fixtures`, and a quote that
  is missing or ambiguous in its document throws rather than being stored with
  a plausible-looking span.
- Quotes render by slicing `documents.raw_text` at stored offsets. There is no
  quote string column to drift.
- `verifyQuote` self-checks its own offsets and fails closed if the mapping
  breaks.
