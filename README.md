# VOTR

Every position, traceable to the receipt.

Civic app for young voters. Enter an address, get every race on your ballot, with
each candidate's positions reconstructed from what they have actually said on the
record. Every insight carries the exact quote, the source, and a one-tap link back
to the original.

## Read these first

If you are an agent picking up work in this repo, read in this order:

1. `CLAUDE.md` at the repo root. The brief. Conventions, the pipeline, and the one
   rule that overrides everything.
2. `docs/VOTR-spec.md`. The full product spec. Read before anything structural.
3. `KICKOFF.md`. Scaffolding history and the planned session order. Already executed.

`CLAUDE.md` is read every session. If a rule in it turns out to be wrong, edit the
file rather than working around it.

---

## Prerequisites

**Node.js 24.x.** Hard requirement, not a preference. The `neon` CLI's `skills`
subcommand refuses to run below 22.20.0, and this repo was built and verified on
24.21.0.

Check before doing anything else:

```bash
node -v    # must be >= 22.20.0, 24.21.0 is what we use
```

If yours is older, install a version manager rather than overwriting the system Node:

- **Windows:** [nvm-windows](https://github.com/nvm-windows/nvm/releases), then
  `nvm install lts && nvm use lts`. If `node -v` still reports the old version after
  installing, an existing `C:\Program Files\nodejs\` entry is winning the PATH race.
  Remove that entry from the system PATH so nvm's shim resolves first, then open a
  new terminal.
- **macOS / Linux:** `nvm install --lts && nvm use --lts`.

Restart your terminal and your editor after switching. Long-running shells keep the
old PATH and will silently use the old Node.

---

## Setup

```bash
git clone https://github.com/BrianCode9/VOTR.git
cd VOTR
npm install

npm i -g neon@latest && neon login
npm run setup
```

`npm run setup` is the only command you have to read the output of. It checks
your Node version, pulls the database credentials from Neon, tells you which
API keys are missing and where to get each one, and then proves the database
and your Anthropic key actually answer. Re-run it any time; it is safe.

No credentials are in this repository and none should ever be committed. Each
person supplies their own keys in `.env.local`, which is gitignored.

That is the whole database setup. `.neon` is committed to this repo, so the clone
already knows which Neon org, project, and branch to use. `neon env pull` reads it and
writes `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, and `NEON_BRANCH` into your
`.env.local`.

You do not paste a connection string by hand, and nobody should be sending you one
over chat. `neon env pull` is safe to re-run at any time: it rewrites only those three
variables and leaves your API keys alone.

If `.neon` is ever missing or you need to relink from scratch:

```bash
neon link --project-id cold-glade-81327185 --branch production -y
```

Then fill in the three remaining keys in `.env.local` by hand. Ask whoever owns the
accounts for them:

```
DATABASE_URL            # written by `neon link`, do not edit
DATABASE_URL_UNPOOLED   # written by `neon link`, do not edit
NEON_BRANCH             # written by `neon link`, do not edit
ANTHROPIC_API_KEY       # you supply
NVIDIA_API_KEY          # you supply
ELEVENLABS_API_KEY      # you supply
```

`.env.local` is gitignored and must stay that way. `.env.example` is committed and
documents the shape only. Never put a real value in it.

Verify:

```bash
npm run build    # must pass
npm run dev      # http://localhost:3000
```

---

## How the database works for everyone

**There is one database and the whole team shares it.**

It is a hosted Neon Postgres instance, reachable over the internet from any machine.
Nobody installs Postgres. Nobody runs Docker. There is no local database and there is
no per-developer copy by default.

```
Neon org      org-nameless-credit-38867566
Neon project  cold-glade-81327185
branch        production  (br-raspy-base-b4ytfcfy)
Postgres      18.6
```

Every teammate's `neon link` points at that same `production` branch, so everyone
reads and writes the same rows. When you ingest an article, it appears for everyone,
including whichever laptop runs the demo.

**Why shared rather than per-developer.** Filling the feed costs real money and real
time: Anthropic extraction calls, Nemotron judge calls, and the ingest crawl itself.
If everyone kept a private database, everyone would pay that cost separately, and the
data you rehearse the demo against would exist on exactly one machine. Ingest once,
everyone benefits.

### Getting access

You need to be a member of the Neon org before `neon env pull` will work. Ask the
project owner to invite you in the Neon console. Once you are in, `neon login` plus
`neon env pull` is all you need. The credentials arrive automatically.

The project identifiers are committed in `.neon` and are not secrets. The credentials
are not committed anywhere and are fetched per person against their own Neon login.

Send a new teammate exactly this:

```
1. Accept the Neon org invite in your email.
2. Install Node 24:  https://github.com/nvm-windows/nvm/releases
                     then:  nvm install lts && nvm use lts
3. git clone https://github.com/BrianCode9/VOTR.git
   cd VOTR
   npm install
4. npm i -g neon@latest
   neon login
   neon env pull
5. Open .env.local and paste in the three API keys I sent you separately:
   ANTHROPIC_API_KEY, NVIDIA_API_KEY, ELEVENLABS_API_KEY
6. npm run build   (must pass)
   npm run dev
```

The three API keys are the only values that have to be passed person to person. The
database credentials are not among them.

This is why the connection string is not in the repo and should not be pasted into
Discord. Access is granted per person and can be revoked per person.

### Two connection strings, and which to use

`neon link` gives you both. They are not interchangeable.

| Variable | Endpoint | Use for |
|---|---|---|
| `DATABASE_URL` | pooled (`-pooler` in the host) | app runtime, server components, API routes |
| `DATABASE_URL_UNPOOLED` | direct | `drizzle-kit` migrations, one-off scripts |

Migrations through the pooler misbehave. If `drizzle-kit` hangs or reports something
incoherent about the connection, you are on the pooled string. Switch to the unpooled
one.

### The rule that keeps a shared database from hurting

**A shared database means a bad migration breaks everyone at once.**

Normal feature work: just use `production`. Reading, writing, ingesting, and building
UI are all safe. Go ahead.

Changing `db/schema.ts` or running `drizzle-kit push`: **branch first.**

```bash
neon checkout my-schema-change --create   # create, switch, re-pull .env.local
# ... do the schema work, verify it ...
neon checkout production                  # back to the shared branch
```

`neon checkout` does all three things in one step: it creates the branch if you pass
`--create`, repoints `.neon` at it, and rewrites `DATABASE_URL` in `.env.local` to
match. Check `cat .neon` if you are unsure which branch you are on.

A Neon branch is a copy-on-write clone. It is instant, it includes the existing data,
and it is completely isolated. You break only your own copy. This is the "test
database" answer without anyone installing anything.

Say so in the team chat before you push a schema change to `production`. It is the one
operation that can stop four other people from working.

### If the database seems broken

```bash
neon me                  # are you authenticated
cat .neon                # are you linked, and to which branch
neon branches list       # does the branch still exist
```

Then confirm `.env.local` actually has a `DATABASE_URL` value. An empty one produces
confusing downstream errors rather than an obvious connection failure.

---

## Commands

```bash
npm run dev      # dev server
npm run build    # production build, must pass before you push
npm run lint     # eslint
```

Neon:

```bash
neon env pull                   # refresh DB credentials in .env.local
neon branches list              # what branches exist
neon checkout <name>            # switch branch, re-pull .env.local
neon checkout <name> --create   # create it first, then switch
neon config plan                # preview policy changes from neon.ts
neon deploy                     # apply neon.ts, then re-pull env vars
```

---

## Stack

Next.js 16 (App Router) and React 19 with TypeScript. Tailwind v4 and shadcn/ui on the
Radix base. Drizzle ORM over Neon Postgres. Zod for every schema. Anthropic with tool
use for extraction, NVIDIA Nemotron for routing and judging, ElevenLabs for
transcription and briefings.

Fonts are Archivo and Martian Mono, loaded via `next/font` in `app/layout.tsx` and
bound to Tailwind's `--font-sans` and `--font-mono`.

The import alias `@/*` resolves to the repo root. There is no `src/` directory.

See `CLAUDE.md` for the full list, including the explicit do-not-add list. Do not
introduce a dependency that is on it.

---

## Things that will bite you

**Quote offsets.** Verification returns offsets into the original `raw_text`, never
into a normalized copy. Offsets computed against normalized text pass a naive test and
render garbage. `CLAUDE.md` has the full ladder. This is the single most important
correctness property in the codebase.

**Nothing renders unverified.** If a quote fails verification it does not ship. Not as
"approximate," not as a paraphrase. It gets logged to the rejections table.

**Node version.** See above. Most confusing setup failures trace back to it.

**Stale PATH.** After any Node version change, restart the terminal and the editor.
