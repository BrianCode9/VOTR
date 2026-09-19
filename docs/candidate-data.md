# Free 2026 candidate data import

Imported into the project's configured Neon database on September 19, 2026.
The read-back audit is in [verification-report.json](../data/candidates/verification-report.json).

## Coverage

| Source | Federal records | State candidates |
|---|---:|---:|
| Federal Election Commission | 3,848 | 0 |
| California Secretary of State | 104 | 220 |
| Maryland State Board of Elections | 21 | 303 |
| **Total added** | **3,973** | **523** |

- 4,496 new candidate records across 735 races; no local offices imported.
- 43 new source documents and 42 curated policy summaries covering 29 candidates.
- Existing 21 demo candidates, 10 documents, and 44 insights were retained.
- Database totals immediately after import: 4,517 candidates, 53 documents, 86 insights.
- Five incomplete FEC records were quarantined in the snapshot's rejections array.
- Federal coverage spans all 50 states. State-office coverage is California and Maryland, not nationwide.
- FEC registrations include people who may have lost a primary, withdrawn, or never qualified for the ballot. They are explicitly cycle records, not confirmed general-election nominees.
- Maryland active write-ins are identified separately.
- California state judicial retention races and Maryland judicial races were not included in this first import.
- All data access used free public files/pages. No paid source subscriptions or model API calls were used.
- Candidate policy coverage is incomplete. Missing evidence does not imply opposition or neutrality.
- Campaign statements are claims about candidates' positions, not independent verification of outcomes or statistics.

## Sources

- FEC candidate master: https://www.fec.gov/files/bulk-downloads/2026/cn26.zip
- FEC field definitions: https://www.fec.gov/campaign-finance-data/candidate-master-file-description/
- California certified general-election list: https://elections.cdn.sos.ca.gov/statewide-elections/2026-general/cert-list-candidates.pdf
- Maryland general-election list: https://elections.maryland.gov/elections/2026/general_candidates/2026_GG_statewide_candidatelist.html
- California candidate-submitted statements: https://voterguide.sos.ca.gov/candidates/
- Campaign sites linked from Maryland's official roster. Source URLs are retained on each stored document.

## Storage and interpretation

The existing districts, races, candidates, documents, and insights tables remain in use.
The additive candidate_sources table links each imported candidate to its official source,
source key, source-file hash, retrieval date, campaign website (when supplied), and source metadata.

Use candidate_sources.election_stage:
- general: official California or Maryland general-election list.
- cycle: FEC 2026 registration; November 3 is the cycle's general-election anchor date,
  not a claim that the person qualified for that ballot.

Use candidacy_status for the finer distinction:
certified_general_candidate, official_general_candidate, general_write_in,
or fec_filing_not_ballot_verified.

The party field retains official party labels (or FEC codes where no display mapping is defined).
Nonpartisan ballot labels must not be interpreted as the person's private party registration.
Use incumbent_known: when false, incumbency is unknown even though the legacy candidates.incumbent
column requires a boolean. Absence of a California incumbent marker is treated as unknown.

Source-record policyDocumentIds link candidates to collected policy documents, including
documents with no published insight yet. The existing demo records have no candidate_sources row.
Do not mix their fictitious demo race with official race coverage.

The quote manifest contains manually selected neutral summaries. Importing verifies:
1. A unique candidate identity matches the relevant source association.
2. Guide quotations occur in that candidate's own section.
3. Each quotation occurs exactly once in the source text.
4. The exact stored character span resolves back to the expected quotation.

The importer does not infer positions from party, voting records, or endorsements.
Judge ratings and extractor confidence are left null; no model judge was run.
Published summaries are attributed as own_words or characterization.
Documents remain immutable. Changed pages receive a content-version URL fragment.

## Use in application queries

Example: verified-list candidates in Maryland (including separately labeled write-ins).

SELECT c.id, c.name, c.party, r.office, d.state, d.name AS district,
       s.candidacy_status, s.election_stage, s.source_url, s.campaign_website,
       CASE WHEN s.incumbent_known THEN c.incumbent ELSE NULL END AS incumbent
FROM candidates c
JOIN candidate_sources s ON s.candidate_id = c.id
JOIN races r ON r.id = c.race_id
JOIN districts d ON d.id = r.district_id
WHERE d.state = 'MD' AND s.election_stage = 'general'
ORDER BY r.office, d.name, c.name;

Example: policy summaries with supporting quotations. JavaScript must slice the stored
raw_text using quote_char_start/end; these are JavaScript UTF-16 offsets, not PostgreSQL
character indexes. The existing getFeed query already does this correctly.

SELECT i.id, c.name, i.issue_tag, i.position_text, i.attribution,
       d.source_name, d.url, d.raw_text, i.quote_char_start, i.quote_char_end
FROM insights i
JOIN candidates c ON c.id = i.candidate_id
JOIN documents d ON d.id = i.document_id
JOIN candidate_sources s ON s.candidate_id = c.id
WHERE i.status = 'published';

## Reproduce or audit

Requires installed npm dependencies, Python 3, pdftotext on PATH, and DATABASE_URL in .env.local.
The checked-in normalized snapshot contains no mailing addresses, email addresses, or phone numbers.

Download and prepare official rosters:
    npm run data:fetch
    npm run data:prepare

Inspect changes in data/candidates/candidates-2026.json before loading a newly downloaded snapshot.
This hackathon importer inserts missing identities and preserves existing rows; it is NOT an
automatic synchronizer for withdrawals, renamed candidates, or changed party affiliations.

Apply the schema migration and import:
    npm run db:migrate
    npm run data:import
    npm run data:import -- --apply

Collect source pages and derive candidate statement sections:
    node --import tsx scripts/inspect-policy-sources.ts
    node --import tsx scripts/fetch-campaign-evidence.ts

Validate and import the curated policy manifest:
    npm run data:policies
    npm run data:policies -- --apply

Audit:
    python scripts/test-candidate-parsers.py
    npm run data:verify
    npx tsc --noEmit

Replaying the same snapshot is idempotent: it creates no duplicate candidates, races,
documents, or insights. Candidate records are committed in one transaction; policy documents
and insights are committed in a separate transaction.

The raw download cache is gitignored. Public-source pages can change or be unavailable;
a missing or changed quote fails validation instead of silently substituting a new position.
The general-purpose persist demo script still resolves names into a demo race; use the dedicated
data import commands for this dataset.

