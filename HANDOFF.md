# Handoff — 2026-09-19

Picking this up on another machine. `STATUS.md` has the full build order; this
is just what moved today and what to do next.

## Setup

```bash
npm install
npm run setup     # pulls .env.local from Neon; needs an org invite
npm run dev
```

## The flow (new)

The site had two routes and every button was a `#anchor` to another section of
the landing page. It now has one question and three destinations.

```
/                            pick a state, optionally add an address
/ballot/[state]?district=N   your races and candidates
/candidate/[id]              one person, their verified quotes
/ballot/[state]/topic/[slug] one issue across your ballot
/feed                        every verified quote (not in the main flow)
```

Location resolves through the **US Census geocoder** (no API key) in
`lib/location/`, and is stored in a `votr_location` cookie (`CA`, or `TX-7`).
The state select is the floor, the address only narrows to a congressional
district. Form posts to a Server Action and works with JS disabled.

## Data state

| | |
|---|---|
| Certified candidates | 4,496 across 50 states |
| Photos | **484** across **48 states** (was 186 / 2 states) |
| Verified quotes | CA 23, MD 19. **Everywhere else: 0** |
| Tests | 221 passing |

### Ballot provenance — read this before trusting a ballot

Only **CA and MD** come from a state election authority and are real certified
ballots. The other 48 states come from **FEC filings**, which are declarations
of intent, not a place on a ballot.

- `getBallot()` drops FEC status `N` (filed, not yet a statutory candidate).
  That removed 55 of PA's 114 and 12 of WV's 29.
- `Ballot.certification` is `certified` | `filings` | `mixed`, and the ballot
  page, candidate tiles and profiles all say which. Do not remove that
  labelling without replacing the underlying data.

## Fixed today

- **Photo importer was finding nothing outside CA/MD.** It passed raw DB names
  as Wikipedia titles, and MediaWiki titles are case-sensitive after the first
  letter — `WESLEY HUNT` matches nothing. 3,849 of 4,517 names are ALL CAPS
  because most states publish them that way; CA and MD don't, which is the
  entire reason they were the only states with photos. `toWikiTitle()` in
  `scripts/import-candidate-photos.mjs`, plus a `--state=PA,WV` flag so a
  scoped run takes a minute instead of 20.
- **District filter leaked.** A Maryland voter in district 3 saw all 71 House
  of Delegates districts. A race is yours only if it is statewide or your exact
  district; the rest moved to a labelled "Elsewhere in <state>" disclosure.
- **DC resolved to "district 98."** Census uses 98 for delegate seats. Rejected
  now — note at-large states return `00`, which IS real.
- **"See the original"** (build order step 9) — position cards open the stored
  document at the verified character span. Fetches `?full=false` on expand.
- Landing page candidate cards hardcoded `photoUrl: null`. They show real
  portraits now.

## Next, in the order I'd do it

1. **Verified quotes outside CA/MD.** Biggest gap by far — 48 states render a
   correct ballot where every candidate reads "Nothing on the record yet."
   This is an ingest run, not frontend work.
2. **Real PA/WV ballots.** PA's field is settled (primary May 19, withdrawals
   closed Aug 10) but there is **no bulk download** — the post-primary listing
   lives in the pavoterservices.pa.gov ASP.NET app. Either scrape it or request
   the data from `ra-elections@pa.gov`. This also brings in PA's Governor race,
   which is missing entirely today.
3. **+257 photos via FEC ID.** `candidate_sources.source_record->>'fecId'`
   joins to the `congress-legislators` dataset, which carries exact Wikipedia
   titles. Verified: 425 of our candidates match a sitting member, 257 have no
   photo. This beats name matching — nothing was ever going to turn
   `PAUL DR. GOSAR` into `Paul Gosar`.
4. **FEC name parsing.** `GEORGE J JR KELLY`, `NICHOLAS II SINGELIS` — the
   `LAST, FIRST MIDDLE SUFFIX` format was parsed into the wrong order. This is
   a data fix; `displayName()` only corrects casing.
5. **`npm run backfill`.** `speakers` has 0 rows, so every `speaker_id` is
   null and the timeline API returns nothing.

## Unused after the strip-down

`components/landing/party-beliefs.tsx`, `final-cta.tsx`, and the `partyViews`
data in `lib/landing/content.ts` are no longer imported anywhere. Delete when
you're sure they're not coming back.
