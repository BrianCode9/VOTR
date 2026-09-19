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

npm run setup
```

That is the whole setup. `npm run setup` installs the neon CLI if you do not
have it, signs you in to Neon (a browser window opens), pulls the database
credentials into your `.env.local`, tells you which API keys are missing and
where to get each one, and then proves the database and your Anthropic key
actually answer. Re-run it any time; it is safe.

If it says `neon env pull failed`, you are not in the Neon org yet. Ask for an
invite and re-run. Nothing else can fix that locally.

### API keys

Three keys go in `.env.local`, which is gitignored. Two are yours, one is the
team's.

| Key | Whose | Where |
|---|---|---|
| `ANTHROPIC_API_KEY` | yours | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| `ELEVENLABS_API_KEY` | yours | [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys) |
| `NVIDIA_API_KEY` | **shared, one for the team** | ask whoever set the project up |

Make your own Anthropic and ElevenLabs keys. Do not make your own NVIDIA key;
there is one for the whole team, so ask for it rather than burning a second
free tier.

You do **not** add `DATABASE_URL` by hand. `npm run setup` pulls it from Neon
against your own login, so nobody passes a database password around.

Re-run `npm run setup` after adding keys. It calls each API for real rather
than just checking that a value is present.

Nothing secret is committed here, and nothing secret should be. This repo is
public: GitHub scans public repositories for credentials and providers revoke
leaked keys automatically, so committing a key takes the team down rather than
saving anyone time.

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

## The API, for whoever is building the frontend

The full contract is `docs/openapi.yaml`. Paste it into
[editor.swagger.io](https://editor.swagger.io) if you want it rendered.

Everything lives under `/api/v1`. The unversioned paths that shipped first
(`/api/feed`, `/api/topics`, `/api/profile`, `/api/saved`,
`/api/insights/:id/source`, `/api/insights/:id/share`, `/api/share/:id`) still
work and are literally the same handler object, so they cannot drift. New code
should use `/api/v1`.

Inside v1 the rule is **additive only**: a new field may appear on any response
at any time, a new value may be added to any enum, and a new query parameter
may appear. What will not happen is a field changing type, changing meaning, or
disappearing. Anything that cannot be done additively gets `/api/v2`.

That last point matters for the enums below: **branch with a default case, not
exhaustively.** A `switch` with no `default` will break the day a fourth badge
ships.

### Build against fixtures, not against the pipeline

Filling the feed for real costs model calls and a crawl. You do not need
either:

```bash
npm run seed:demo            # install the demo dataset
npm run seed:demo -- --reset # wipe it and reinstall, for a clean demo
npm run seed:demo -- --clear # remove it
```

or, if the app is running and you do not have a terminal in this repo:

```bash
curl -X POST localhost:3000/api/v1/dev/seed -d '{"reset":true}'
curl localhost:3000/api/v1/dev/seed          # what is installed
```

Three invented speakers, six invented documents, fifteen insights, covering
every enum value below at least once, plus cards at one source and cards at
two. `GET /api/v1/dev/seed` reports the expected counts, so a short seed is
visible rather than silent. The data does not move between two page loads.

The documents are marked `isSynthetic: true` and the people in them are not
real. Nothing in the fixture set is a real quote from a real politician, and it
must stay that way: an app whose whole claim is traceability cannot circulate a
fabricated quote attributed to someone who exists.

### The enums you will branch on

#### `presentationMode` - `stated` | `nudge_verify`

**Read this one before `claimSupportConfidence`.** It says what you are allowed
to do with the card.

| Value | What it means | What the UI must do |
|---|---|---|
| `stated` | The quote plainly supports the claim. | Render the claim as written. |
| `nudge_verify` | The claim is an inference the quote supports only weakly. | **Never present it as flatly stated fact.** Lead with the quote, show a "check this yourself" affordance, link the source. |

The threshold behind it lives on the server so it can be moved without a client
release, and so two surfaces cannot disagree about where the line is. Do not
re-derive this from the raw score.

#### `confidenceLabel` - `high` | `medium` | `low`

The bucketed `claimSupportConfidence`: how directly the quote supports this
card's claim. Defaults are `high >= 0.8`, `medium >= 0.5`, `low` below, and
they are configurable via `CONFIDENCE_HIGH_THRESHOLD` and
`CONFIDENCE_MEDIUM_THRESHOLD`.

`low` is also what an **unrated** card gets. An insight nothing rated is exactly
the case the nudge exists for, so it is not put in the middle band. `low` is
the only label with `verifyYourself: true` and `presentationMode:
nudge_verify`; use it for a chip or a sort, and use `presentationMode` for the
wording.

This is the third confidence number in the system and the three are not
interchangeable:

| Field | Asks | Where it comes from |
|---|---|---|
| `quoteSimilarity` | Was the quote copied correctly? | Measured against the stored document |
| `claimSupportConfidence` | Does the quote support this claim? | The extractor rates each item |
| (gates `FLIP_FLOP`) | Did a change of position actually occur? | The extractor rates each stance change |

#### `flags` - `NEW` | `FLIP_FLOP` | `UNVERIFIED_CLAIM`

An array. A card can carry several: a first-ever stance change on a topic is
both `NEW` and `FLIP_FLOP`. `flag` (singular) is a legacy mirror of `flags[0]`.

- **`NEW`** - the first thing on record for this speaker on this topic.
  Assigned at write time and never recomputed, so a card that was the first of
  its kind keeps the badge once later ones arrive. That is what a reader
  scrolling a feed means by "new". Unattributed cards never carry it.
- **`FLIP_FLOP`** - a recorded change of position that cleared the confidence
  bar. **A `stance_change` card WITHOUT this badge is a shift the backend is
  not willing to call a flip-flop.** Do not label it as one; it is the single
  most damaging thing this app can get wrong.
- **`UNVERIFIED_CLAIM`** - a factual assertion a reader should not take on
  trust: either it is not quickly settleable, or nothing has settled it yet.
  Note the gap: a claim checked and found **false** loses this badge, because
  it is no longer unverified. Read `factCheckStatus` for that.

#### `factCheckStatus` - `unresolved` | `supported` | `disputed` | `false`

Where a factual claim stands against an external checker. Only meaningful on
`factual_claim` cards; other card types carry `unresolved` and nothing should
read it.

`unresolved` is the honest default and today the common case. Do not render it
as a neutral or positive state: **a claim nobody has checked is not a claim
that checked out**, and collapsing the two is the error this app exists to
avoid.

#### `checkability` - `easily_checkable` | `requires_expertise` | `unverifiable`

On `factual_claim` payloads. How settleable the assertion is: minutes with a
named source, domain analysis, or not the kind of thing that can be checked at
all (a prediction, a statement of intent, a value judgment). `unverifiable` is
not a failure to check it.

#### The others, briefly

- `cardType` - `stance` | `stance_change` | `factual_claim` |
  `voter_relevance`. The discriminator; `payload` narrows on it.
- `quoteVerified` - `exact` | `normalized` | `transcript` | `fuzzy`. Which rung
  located the quote. There is no failure value: a quote that could not be
  located was never stored. `fuzzy` means the string was corrected, and
  `quoteSimilarity` says by how much.
- `attribution` - `own_words` | `characterization`. Worth surfacing: "reported
  to support X" is a weaker thing than "said X".

### `sourceDiversity`, and what the number counts

```json
"sourceDiversity": { "count": 3, "sources": [{ "sourceName": "…", "sourceUrl": "…" }] }
```

`count` is **distinct outlets including this card's own**, so the floor is 1
and there is no 0. Two articles from the same outlet count once. `sources`
lists the others and is capped by `?sourceDiversityLimit` (default 3), so
`count` can exceed `sources.length` - render "+N more" from the count, and call
`GET /api/v1/insights/:id/sources` if someone taps it.

### Timelines

`GET /api/v1/speakers/:id/timeline` takes a **speaker** id, not a candidate id.
A candidate row is one person's appearance on one ballot line; a speaker is the
person, across races and across the three ways an outlet might spell their
name. Feed items carry `speakerId` for exactly this handoff.

Default `include=flip_flops` and `order=asc`. `include=stance_changes` widens
it to every recorded shift, including the ones that did not clear the
confidence bar - if you use that mode, read `flags` on each entry and do not
label the extras as flip-flops.

### Errors

One shape everywhere:

```json
{ "error": "human-readable, may be reworded", "code": "not_found", "details": {} }
```

Switch on `code`: `bad_request`, `missing_user`, `not_found`, `unprocessable`,
`server_error`.

### Identifying a reader

There is no account system. Endpoints that need a reader take an anonymous
session string as the `x-votr-session` header, the `votr_session` cookie, or a
`userId` query parameter, in that order. 8 to 128 characters of
`[A-Za-z0-9_-]`. The server never mints one: an endpoint that needs a reader
and does not get one returns 400 `missing_user` rather than inventing a user
and writing rows under it.

---

## Commands

```bash
npm run dev          # dev server
npm run build        # production build, must pass before you push
npm run lint         # eslint
npm test             # unit tests, no database or API key needed
```

Data:

```bash
npm run ingest       # pull an RSS feed into documents
npm run persist      # extract + verify + store insights (costs model calls)
npm run seed:demo    # install the demo fixtures, no model call
npm run backfill     # one-time after migration 0003: speakers + corroboration
npm run corroborate  # recompute source-diversity counts
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
