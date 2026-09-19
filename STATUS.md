# Status

Against the build order in `docs/VOTR-spec.md` section 13. Last updated 2026-09-19.

## Build order

| # | Step | State |
|---|---|---|
| 1 | Document ingestion (RSS and GDELT) into Postgres with raw text | **done** |
| 2 | Nemotron triage router | **blocked** - NVIDIA key invalid |
| 3 | Extraction with Zod-validated tool use | **done** |
| 4 | Quote verification with character offsets | **done** |
| 5 | Nemotron verification judge plus routing | **blocked** - NVIDIA key invalid |
| 6 | Card feed from verified insights, tokens and type in place | **done** |
| 7 | Address to district resolution | not started |
| 8 | Voting mechanics tab | not started |
| 9 | Source tab and "why am I seeing this" | **partial** - why-am-I-seeing-this ships on the card; source tab not started |
| 10 | Scribe transcription and timestamp jump | not started - ELEVENLABS_API_KEY empty |
| 11 | Change detection second pass | not started |
| 12 | Reactions, then comments with moderation | not started - tables exist, no code |
| 13 | Judge eval, three arms, one chart | **blocked** - NVIDIA key invalid |
| 14 | Audio briefing | not started |
| 15 | Compare view, share image, timeline, add-a-source | not started |
| 16 | Conversational agent | not started |

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
npm run dev        # feed at localhost:3000
npm run ingest     # pull an RSS feed into documents
npm run persist    # extract + verify + store insights
npm test           # 17 verification tests
```

## Known gaps, deliberate

**`judge_rating` is null on all 44 insights** and status is `published`. That is
not the real routing from spec section 3. The judge pass re-routes these rows
once step 5 can run.

**Most insights are tagged `other`.** The issue enum in `lib/schemas/insight.ts`
has no press-freedom tag and the current documents are mostly about press
access. Two-line fix, left open because it is a product taxonomy call.

**Candidate resolution is by name only**, into one demo race. Real resolution is
step 7.

**Repeated phrases are not collapsed** by the verification ladder, only repeated
words, per the spec wording. A transcript stutter like "we will we will" fails
verification rather than risking a match the speaker never said contiguously.

**`zod-to-json-schema` is installed but unused.** Zod 4 has native
`z.toJSONSchema`, which is what `lib/schemas/tool-schema.ts` uses. `CLAUDE.md`
still names the package.

## Rules that are enforced in code, not convention

- `insights.quote_char_start/end` are NOT NULL, so a failed verification cannot
  exist as a half-record.
- `comments.moderation_status` defaults to `hold`, so an unmoderated comment
  cannot leak into a read.
- The synthetic-document badge lives in `InsightCard`, not the data layer.
- Quotes render by slicing `documents.raw_text` at stored offsets. There is no
  quote string column to drift.
- `verifyQuote` self-checks its own offsets and fails closed if the mapping
  breaks.
