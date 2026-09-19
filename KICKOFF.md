# VOTR kickoff

Do the setup here yourself, then hand Claude Code the prompt at the bottom. Scaffolding by hand takes ten minutes and saves the agent from making decisions the brief has already made.

---

## 1. Scaffold

```bash
npx create-next-app@latest votr \
  --typescript --tailwind --app --src-dir=false \
  --import-alias "@/*" --eslint

cd votr
npx shadcn@latest init
npx shadcn@latest add button badge sheet card skeleton sonner

npm i drizzle-orm postgres zod zod-to-json-schema
npm i @anthropic-ai/sdk
npm i motion vaul lenis sonner
npm i rss-parser @extractus/article-extractor
npm i -D drizzle-kit tsx @types/node
```

Fonts are on Google Fonts. Load them through `next/font` in the root layout:

```ts
import { Archivo } from 'next/font/google'
// Martian Mono: import { Martian_Mono } from 'next/font/google'
```

## 2. Database

Create a Postgres instance on Neon or Supabase. Copy the connection string.

## 3. Environment

Create `.env.local` with real values before the first prompt. An agent that hits a missing key will stub the call and move on, and you will not find out until four features later.

```
DATABASE_URL=
ANTHROPIC_API_KEY=
NVIDIA_API_KEY=
ELEVENLABS_API_KEY=
```

Add `.env.local` to `.gitignore` and confirm it is actually ignored before your first commit.

## 4. Drop in the docs

```
votr/
  CLAUDE.md              <- agent brief, repo root
  docs/VOTR-spec.md      <- full product spec
```

## 5. Commit

```bash
git init && git add -A && git commit -m "scaffold"
```

Commit before the agent touches anything. You want a clean point to reset to.

---

## First session prompt

Paste this. It covers the ingestion adapter and the verification ladder together, because verification is what everything else depends on and the thing easiest to quietly get wrong.

```
Read CLAUDE.md and docs/VOTR-spec.md first.

Build steps 1 and 4 of the pipeline only. Do not build extraction,
the judge, or any UI yet.

1. Drizzle schema in db/schema.ts for the tables in spec section 11.
   Generate and run the migration.

2. lib/adapters/types.ts: the normalized Document interface.

3. lib/adapters/rss.ts: fetch a feed, pull full article text with
   @extractus/article-extractor, return Document[]. Must survive a
   single failing article without dying.

4. lib/adapters/gdelt.ts: a thin fetch wrapper over the GDELT DOC 2.0
   API. No client library.

5. lib/extract/verify.ts: the verification ladder exactly as written
   in CLAUDE.md. Signature:

     verifyQuote(quote: string, doc: Document): VerifyResult

   Returns either { ok: true, start: number, end: number } with offsets
   into the ORIGINAL raw_text, or { ok: false, reason: string }.

6. Tests for verify.ts covering at minimum:
   - exact match
   - curly quotes in the source, straight quotes in the candidate
   - an HTML entity in the source
   - collapsed whitespace and a line break inside the quote
   - a transcript with filler words
   - a quote that genuinely is not present, which must fail
   - THE CRITICAL ONE: after a normalized match, assert that
     doc.raw_text.slice(start, end) returns the correct original span.
     Offsets computed against the normalized copy will pass a naive
     test and produce garbage in the UI.

7. A scripts/ingest.ts I can run with tsx that pulls one RSS feed
   into the database end to end.

Show me the verify.ts approach before you write it.
```

---

## Session order after that

| Session | Build |
|---|---|
| 2 | Nemotron triage router, then Anthropic extraction with Zod tool use |
| 3 | Nemotron judge plus status routing on the 0 to 3 rating |
| 4 | Design tokens, fonts, and the feed shell with scroll snap |
| 5 | Card component, highlight sweep, see-original sheet |
| 6 | Address to district resolution, voting mechanics tab |
| 7 | Source tab, why-am-I-seeing-this, public failure log |
| 8 | Scribe transcription, timestamp jump, video clip cards |
| 9 | Judge eval, three arms, one Recharts figure |
| 10 | Reactions, comments with moderation |
| 11 | Audio briefing, compare view, share image |

---

## Working notes

**Prune CLAUDE.md as you go.** If a rule turns out to be wrong, or the agent keeps working around it, edit the file rather than repeating yourself in chat. It is read every session, so a stale instruction costs the same as a good one.

**Commit at the end of every session.** Small resets are cheap, large ones are not.

**Ask for the approach before big changes.** Anything touching verification, the judge, or the schema. Everything else, let it run.

**If you fall behind, cut in this order:** conversational agent, timeline, audio briefing, compare view, comments. Do not cut the eval. It is the entire Nemotron submission and it is roughly an hour of work, while those others are polish that nobody sees if the demo runs short.

**Two features that must ship working or not at all:** comment moderation (an open comment box on political content at a live demo is a live grenade) and the synthetic-document badge (an unlabeled synthetic press release contradicts the product's one promise).
