# Agent instructions

Read `CLAUDE.md` at the repo root. It is the brief: conventions, the pipeline,
the verification rules, and the design system. This file only tells you how to
get running.

`docs/VOTR-spec.md` is the full product spec. Read it before anything
structural. `STATUS.md` says what is built and what is not.

## Get running

```bash
npm install
npm run setup     # installs the neon CLI, signs you in, pulls DB creds, checks keys
npm run dev       # feed at localhost:3000
```

`npm run setup` is the only thing you need to interpret. It checks the Node
version, pulls database credentials from Neon, reports which API keys are
absent with a link for each, and proves the database and the Anthropic key
actually answer. Re-run it any time.

## Credentials

Nothing secret is in this repo and nothing secret should ever be committed.

- **Database:** you do not need a connection string. `.neon` is committed, so
  `neon env pull` fetches credentials against your own Neon login. You must be
  a member of the Neon org first; ask the project owner for an invite.
- **API keys:** the team shares one set. Do not create your own accounts. Ask
  for the shared block and paste it into `.env.local`, which is gitignored.
  `npm run setup` then verifies each key actually works.

If a key is missing, stop and say so. Do not stub an API call and continue.
A stubbed call produces plausible output that nobody notices for four features.

## The rule that overrides everything

Nothing renders in the UI unless its quote has been verified by exact match
against stored source text. `CLAUDE.md` has the full ladder. If you are ever
weighing "ship it with a paraphrase" against "do not ship it", the answer is do
not ship it.

Quotes are stored as character offsets into `documents.raw_text` and rendered
by slicing that document. There is no quote string column and there must not be
one.

## Before you change these, say what you are doing first

The verification path (`lib/extract/verify.ts`), the judge, and the data model
(`db/schema.ts`). Everything else, just build it.

A schema change hits a database the whole team shares, so branch first:

```bash
neon checkout my-change --create
# ... change db/schema.ts, npm run db:generate, npm run db:migrate ...
neon checkout production
```

## Commands

```bash
npm run setup     # environment check, run this first
npm run dev       # dev server
npm run build     # must pass before you push
npm run lint
npm test          # verification tests, 17 of them
npm run ingest    # pull an RSS feed into documents
npm run persist   # extract, verify, and store insights
npm run db:generate / db:migrate / db:studio
```

## Gotchas that cost time

- **Node 22.20.0 or newer.** Most confusing setup failures are this.
- **Scripts cannot use top-level `await`.** No `"type": "module"`, so tsx
  compiles to CJS. Wrap in a `main()`, as every script in `scripts/` does.
- **Import the database lazily inside `main()`**, after `process.loadEnvFile`.
  Static imports hoist above it and you get "DATABASE_URL is not set".
- **`DATABASE_URL` is pooled, `DATABASE_URL_UNPOOLED` is direct.** Migrations
  need the unpooled one.
- **NVIDIA's `/v1/models` returns 200 with no key at all.** It proves nothing.
  Only `/v1/chat/completions` tests a key.
