# Handoff — 2026-09-19

`STATUS.md` has the full build order. This file records the current product,
data state, what changed for Pennsylvania and West Virginia, and the next work.

## Setup

```bash
npm install
npm run setup     # pulls .env.local from Neon; needs an org invite
npm run dev
```

## Product flow

```
/                            pick a state, optionally add an address
/ballot/[state]?district=N   your races and candidates
/candidate/[id]              one person, their verified quotes and background
/ballot/[state]/topic/[slug] one issue across your ballot
/feed                        every verified quote (not in the main flow)
```

Location resolves through the US Census geocoder in `lib/location/` and is
stored in a `votr_location` cookie (`CA`, or `TX-7`). The state select is the
floor; the address narrows to a congressional district. The form works with
JavaScript disabled.

## Current data

| Data | Current state |
|---|---|
| Candidate filings | 4,496 across 50 states |
| Candidate photos | 484 across 48 states |
| Published verified positions | CA 23, MD 19, PA 163, WV 38; 0 in the other 46 states |
| PA/WV candidate backgrounds | 28 sourced backgrounds across 35 researched candidates |
| Tests | 225 passing, plus 9 source-parser tests in `scripts/test-candidate-parsers.py` |
| Speaker backfill | Run; 4,310 people resolved |

### Ballot provenance

Only CA and MD are sourced from state election authorities. The other 48 state
pages use FEC filings, which show an intent to run rather than confirmed ballot
access. `getBallot()` drops FEC status `N`; PA has 114 displayed filings and WV
has 29. Keep the existing `certified` / `filings` / `mixed` labels unless the
underlying data is replaced with election-authority records.

## Pennsylvania and West Virginia update

Added 201 published, source-linked policy positions from 111 campaign and
official-office pages: 163 for PA across 26 candidates, and 38 for WV across 7
candidates. Added 28 sourced candidate backgrounds. Candidate profiles show
those separately from an official ballot designation. Exact quote offsets and
candidate identity are checked before storage. The import report is
`data/candidates/pa-wv-import-report.json`; the reviewed evidence is
`data/candidates/pa-wv-evidence.json`.

To fetch the tracked source list again, run `npx tsx scripts/enrich-pa-wv.ts`.
The fetched page snapshots are git-ignored under `data/candidates/raw/pa-wv/`.
Review drafted text before editing the reviewed evidence ledger. Validate with
`npx tsx scripts/import-pa-wv-evidence.ts`; apply with
`npx tsx scripts/import-pa-wv-evidence.ts --apply`.

The remaining PA/WV information gap is broad candidate coverage: most filed
candidates still have no verified positions. A few campaign websites could not
be fetched, and the 201 positions concentrate on the candidates whose sites
publish accessible policy material.

## Fixed in recent work

- The photo importer title-cases all-caps names before Wikipedia lookups and
  supports scoped runs such as `--state=PA,WV`.
- Ballot district filtering no longer leaks other state legislative districts
  into a voter's ballot; those races are disclosed under “Elsewhere in <state>”.
- Census district `98` is rejected for DC delegate lookups; at-large `00` is
  retained.
- Position cards link to the original stored document at the verified quote
  span.
- Landing-page candidate cards show available candidate portraits.
- Candidate profiles now display sourced biography text with a link to its
  campaign or official-office source.
- FEC names parse from the source format instead of flipping on the first
  comma, so the generational suffix lands after the surname and the honorifics
  filers type into the name box are dropped: `GEORGE J JR KELLY` is now
  `GEORGE J KELLY JR`, and `JOHN SEN CORNYN` is `JOHN CORNYN`. 549 of 3,848 FEC
  names were wrong. The filed string is kept as `filedName` on the source
  record, with anything removed under `droppedNameTokens`.
- `displayName()` cases a generational suffix by kind: `Henry Cuellar Jr.`, but
  `Nicholas Begich III`.

## Next work

1. **Certified PA/WV ballots.** The PA post-primary listing is in the state
   voter-services ASP.NET app; obtain an election-authority list or scrape it
   carefully. PA's Governor race is missing. Verify WV candidates against the
   state election authority too.
2. **More verified positions in uncovered states and for uncovered PA/WV
   candidates.** The current pipeline is useful; build out source coverage and
   review claims before importing them.
3. **257 additional portraits by FEC ID.** Join
   `candidate_sources.source_record->>'fecId'` to the `congress-legislators`
   dataset for exact Wikipedia titles.
4. **State and local offices outside CA and MD.** The FEC file is federal only,
   so every non-CA/MD ballot is missing its state legislature and statewide
   rows entirely.

## Repairing imported data

`npm run data:import` inserts with `on conflict do nothing`, so re-preparing the
snapshot never rewrites a row that is already in the table. A fix to a source
parser therefore needs a repair pass to reach the database.
`scripts/repair-fec-names.ts` is the one written for the name fix and the model
for the next: it reports by default and writes under `--apply`, in one
transaction, taking the same advisory lock as the importer.

It also repairs `speakers`, because `normalizeSpeakerName` strips a suffix only
from the end of a name, so correcting a spelling moves the identity key. Where
the corrected key already belonged to another row the two rows were always one
person, and they are merged: 8 such pairs, 4,310 speakers down to 4,302.

**One pass is still outstanding.** The corrected names and the speaker merges
are applied. The refresh of `candidate_sources.source_record`, which writes
`filedName` and `droppedNameTokens` onto all 3,848 FEC rows, is written and
dry-run but not applied; it reports `sourceRecordsRefreshed: 3848`. Run
`npm run data:repair-names -- --apply` to finish it. The script is idempotent,
so re-running it after that is a no-op.

## Unused after the strip-down

`components/landing/party-beliefs.tsx`, `components/landing/final-cta.tsx`, and
the `partyViews` data in `lib/landing/content.ts` are not imported. Delete them
if they are not coming back.
