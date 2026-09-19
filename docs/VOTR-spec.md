# VOTR

**Every position, traceable to the receipt.**

A civic app for young voters. Enter your address, get every race on your actual ballot, with each candidate's positions reconstructed from what they have said on the record. Every insight carries the literal quote, the source, and a one-tap link back to the original. Plus how to vote, where, and by when.

---

## 1. The core promise

We do not claim to tell you what is true. We claim we will never tell you anything we cannot show you the receipt for.

This distinction is the entire product.

"Candidate X supports a rent cap" is not provable. "Candidate X said 'I support a rent cap' on March 4 at the Pittsburgh mayoral debate, here is the transcript at 41:12" is provable absolutely. We build only the second kind.

Consequences of taking this seriously:

- Zero insights render without a verified exact quote and a working link.
- Anything the extraction model asserts that does not exactly match source text is discarded, not softened into "paraphrased."
- Factual claims a candidate makes are labeled as claims and linked, never adjudicated true or false.
- A candidate with three sources visibly shows three sources. We do not paper over thin data with a confident-looking profile.

A tool that claims to have solved truth reads as just another thing to distrust. A tool that shows its work does not.

---

## 2. What the app does

### 2.1 Location resolves to a ballot, not a state

Address in. Out comes the full set of districts the user lives in: congressional, state legislative upper and lower, county, municipal, school board, and any special districts. Each district maps to a set of races, each race to a set of candidates.

This is what makes the app feel personal rather than generic, and it is where most civic tools get lazy by stopping at "here are your two senators."

**The data asymmetry problem.** A federal candidate has thousands of articles. A city council candidate might have twelve. Design for this explicitly:

- Show source counts on every profile.
- Show the date range the profile is built from, so a voter can see if it rests on 2019 coverage.
- Include a "has not commented" state per issue. If a candidate has said nothing about housing, that is genuinely useful information and most tools hide it.

### 2.2 Candidate profile built from the record

For each candidate, the extraction pipeline pulls every stance it can find, grouped by issue. Each stance is a card:

- The position, in plain language
- The exact quote it came from
- Date, outlet, and source type
- One tap to the original document or the video at the exact timestamp
- Corroboration count where the same position appears across independent sources

### 2.3 The source tab

The highest-trust surface in the app, and worth more than its implementation cost.

For a given candidate it shows:

| Element | Why it matters |
|---|---|
| Every outlet feeding the profile, with counts | Shows whether the picture is broad or built on one blog |
| Date range covered | Exposes stale profiles |
| Own words vs. characterization | The single most valuable field in the app |
| Coverage gaps | Outlets we pulled from that had nothing on this race |

**Own words versus characterization** costs one enum field and carries enormous weight. "This is what he said" versus "this is what a reporter said he believes" is the entire difference between a trustworthy civic tool and an aggregator.

### 2.4 Voting mechanics

A persistent tab, not a screen the user finds once.

- Registration deadline for the user's state, with days remaining
- Registration status lookup (link out to the state system, do not try to own this)
- Early voting window and locations
- Election day polling place with a map link
- **Identification (ID) requirements for the specific state.** These vary enormously and are the number one reason people get turned away.
- Mail ballot request deadline and return deadline

The deadline countdown is the mechanism that converts interest into a vote. Give it real estate.

---

## 3. The extraction pipeline (Xtract)

### 3.1 Source adapters

One normalized interface, multiple adapters behind it. Every adapter emits the same `Document` shape.

- **RSS feeds.** `rss-parser` for the feed, `@extractus/article-extractor` or Mozilla `@mozilla/readability` for full article text.
- **GDELT Document (DOC) 2.0 Application Programming Interface (API).** Plain Hypertext Transfer Protocol (HTTP) JavaScript Object Notation (JSON), no key required. Write a 40 line fetch wrapper. Do not look for a client library.
- **Video and audio transcripts.** See section 4.

### 3.2 Extraction

One prompt template per document, producing structured JSON:

- Stance or position stated
- Checkable factual claims made
- Issue tags
- Voter-relevant risk and opportunity framing
- Plain-language rewrite: one neutral, low reading level sentence alongside the original quote
- Confidence self-rating: how directly the quote supports the stated position

Use Anthropic tool use for structured output, not JavaScript Object Notation (JSON) mode and hope. Define the schema once in Zod, convert to JSON Schema for the tool definition, validate the response back through the same Zod object. One schema serves four purposes: prompt contract, runtime validation, database shape, and frontend types.

### 3.3 Quote verification (non-negotiable)

**Never trust the model to return an exact quote.** It will paraphrase, normalize a smart quote, or drop a comma. This is the single highest-risk component in the project.

The verification ladder:

1. Model returns a candidate quote string.
2. Exact substring match against the stored raw source text.
3. On failure, retry against normalized text: collapse whitespace, unify quote characters and dashes, strip Hypertext Markup Language (HTML) entities.
4. On success, store `char_start` and `char_end` integer offsets, **not the quote string**.
5. On failure, discard the insight or hard-flag it as `UNVERIFIED`.

The frontend highlights by offset against the stored document. Traceability becomes a property of the data model rather than a promise from the model.

**Store the full raw source document.** If you store only the Uniform Resource Locator (URL), the "see original" tap breaks the moment a publisher edits their page, and your offsets become meaningless.

**Transcripts need looser matching.** Spoken language has filler words, restarts, and transcription errors, so exact substring match will fail constantly. Normalize more aggressively for transcript sources (strip filler, collapse repeated words) before matching, and store the timestamp range alongside the character offsets so the link back points to the moment, not a position in a text blob.

### 3.4 Change detection is a second pass

Extract insights per document independently. Then run a separate comparison job: for a given (candidate, issue) pair, pull prior insights and make one comparison call.

Doing change detection inside the per-document prompt produces hallucinated history, because the model has no prior context to work from.

Flags produced: `NEW`, `FLIP-FLOP`, `UNVERIFIED CLAIM`.

---

## 4. ElevenLabs integration

### 4.1 The hard no

**Never clone or synthesize any politician's voice.** Not for "hear what he said," not as a demo gimmick, not with a disclaimer.

The entire value proposition is that everything here is verifiable and real. A synthetic voice saying a politician's words destroys that in one screenshot, is the exact thing that gets a civic-tech project written up badly, and likely violates ElevenLabs' terms on public figures. If you want a politician's voice, play the actual clip.

### 4.2 Scribe for the video pipeline (build this first)

Most political video (debates, podcasts, committee hearings, short-form clips) has no usable transcript. Scribe provides speech to text with word-level timestamps and speaker diarization.

Diarization is the reason this matters more than any of the flashier features. In a multi-speaker debate, without it, the extraction pipeline will confidently attribute the opponent's words to your candidate. For a traceability-first app that is a catastrophic failure, not a bug.

Word-level timestamps are what let "see original" open the video at the exact second the candidate says the thing. That is more convincing than any article link and it is the strongest single moment in a live demo.

Transcripts flow into the same extraction pipeline as articles, with the looser matching rules from 3.3.

### 4.3 Audio briefings

A two to three minute spoken rundown of the user's personalized feed. "Here are the four things that changed on your ballot this week."

Young people consume audio while commuting, at the gym, doing dishes. A civic app that fits that slot gets opened twice. One that requires sitting down to read does not.

Use a single neutral narrator voice throughout. When the briefing reaches a quote, either read it in the narrator voice with explicit framing ("in his words, quote...") or drop in the real audio clip where one exists. Never synthesize the candidate.

### 4.4 Conversational agent (optional)

Spoken ballot question and answer. "Who is running for my school board and what do they think about the budget?"

ElevenLabs Agents handles the voice loop; the knowledge layer comes from the verified insight store.

Non-negotiable constraints: the agent answers only from verified insights, cites out loud ("according to a March interview with the Post-Gazette, she said..."), and says "I don't have anything on the record about that" rather than filling the gap. An agent that free-associates about candidates is a liability.

This is the most demo-friendly feature and the most likely to embarrass you live. Build it last or not at all.

### 4.5 Accessibility

Text to speech on the plain-language rewrite, with multilingual output. Voters with low literacy, vision impairments, or English as a second language are a real and underserved segment of the electorate. This is a genuinely useful feature, not a demo trick.

---

## 5. The short-form feed

### 5.1 The tension, and how it resolves

Short form optimizes for speed. Traceability asks people to slow down and check a source. These fight each other unless you do one specific thing.

**Make the quote itself the content.** Not a summary with the quote hidden behind a tap. The hero element of every card is the politician's literal words, set large. The receipt and the content become the same object, which means verifying costs the user nothing because they already read the evidence.

Everything else in the feed follows from that.

### 5.2 Card mechanics

Borrow the grammar users already have muscle memory for:

- Full-bleed, one insight per viewport, vertical scroll snap. Use Cascading Style Sheets (CSS) `scroll-snap-type: y mandatory` rather than a JavaScript carousel. Smoother, and roughly twenty lines of code.
- No chrome. Candidate name small at top, source and attribution small at bottom, quote owns the middle.
- Right rail for actions: save, share, react, see original.
- Preload the next three cards. Any loading state between items destroys the feel completely.

The flag badge is the hook. `FLIP-FLOP` in the corner is the "wait, what" moment that stops a thumb. Rank flagged cards high in the opening of a session, then settle into the user's issue tags.

### 5.3 Three short-form formats

**Video clip cards.** Scribe gives you word-level timestamps, which means you have an eight second clip of the politician saying the thing. Autoplay muted with burned-in captions inside the card. This is literally short-form political video where the receipt is the content, and it comes nearly free once transcription is in the pipeline. It is the strongest single artifact the app can produce.

**Audio briefing over the feed.** The ElevenLabs briefing plays while cards auto-advance in sync. That is a short-form video feed without shooting any video.

**Your ballot in 60 seconds.** A finite, completable run with a progress bar across the top. This is the differentiator rather than the imitation: a ballot is finite, and finishing feels like something. It is also the best down-ballot turnout lever in the app, because people complete a bar they can see.

### 5.4 One thing to resist

No infinite feed. An endless scroll of political content is a doomscroll, and building one would contradict the civic purpose of the app. Every run is finite and ends on a clear action: register, check your polling place, export your ballot.

### 5.5 Card contents

- The exact quote, dominant
- Position in plain language, secondary
- Source badge: outlet, date, and own words versus characterization
- Flag badge where applicable: `NEW`, `FLIP-FLOP`, `UNVERIFIED CLAIM`
- One-tap "see original" expand
- Swipe to save, tap to share as image

### 5.6 Personal relevance

User picks two or three issues they care about (climate, student debt, jobs, housing). The feed prioritizes cards tagged to those issues. Store client-side or in a Uniform Resource Locator (URL) query parameter. No login.

### 5.7 Additional surfaces

- **Compare view.** Two candidates in the same race, side by side on the user's selected issues. This is the screen people screenshot and send to friends.
- **Timeline view.** For a single candidate, a scrollable mini-timeline of flagged stance changes over time.
- **Source diversity indicator.** Small icon showing how many independent sources corroborate an insight.
- **Sample ballot export.** The user's selections as a saved image or list to bring to the polls. Closes the loop from research to action.
- **Down-ballot nudge.** "You have 7 races on your ballot, you've looked at 2." Most young voters vote the top race and skip the rest. This is a real behavior change lever.
- **Ballot measures.** Often the most consequential thing on a young voter's ballot and the thing they are least prepared for. A plain-language "what a yes vote does / what a no vote does" is high value and lower effort than candidate extraction.

---

## 6. Design direction

### 6.1 Where the look comes from

Not from a component library. The aesthetic is grounded in the artifact the product is actually built on: **the annotated record.** A transcript with a timecode. A document with a passage highlighted. A citation pointing at a specific line.

That gives the interface a visual vocabulary nobody else in civic tech is using, and every element of it is functional rather than decorative. The timecode on a card is a real timestamp. The highlight marks the actual verified span. The design is the data model made visible.

**The signature element is the highlight.** Quotes appear highlighted, the way you would mark a passage in a document you are about to cite. It is the one bold thing in the product, and it means the interface is always showing you the receipt rather than telling you about it.

### 6.2 Two modes, and the switch between them means something

| Mode | Surface | Treatment |
|---|---|---|
| Consumption | The feed | Dark, full-bleed, cinematic. Quote and video own the frame. |
| Verification | Source view, document view, source tab | Light. Paper. The full document with the cited span highlighted in place. |

Tapping "see original" moves from dark to light. That transition is the product's whole thesis in one gesture: you were watching, now you are checking. Do not blur this by making both modes the same.

### 6.3 Tokens

```
--ink          #131820   dark field, blue-slate rather than flat black
--ink-raised   #1C222C
--paper        #F1EFE9   verification surfaces
--paper-line   #DCD8CE

--mark         #F2E85C   highlighter; marks verified quote spans only
--stamp        #C5342B   flags: FLIP-FLOP, UNVERIFIED CLAIM

--text-hi      #FAF9F6
--text-lo      #8E96A3
```

One accent with one job. `--mark` never decorates; if something is highlighted, it is a verified span. `--stamp` never appears except on a flag. The discipline is what makes the color mean something.

Never pure `#000` or `#FFF`. Both read as unconsidered.

### 6.4 Typography

Two families, clearly distinct, both drawn from the subject's vernacular.

- **Archivo** (variable, Google Fonts) for quotes and headlines. Tight grotesque with a width axis, set large and slightly condensed. Reads as signage and broadcast chyron, which is the register political speech actually arrives in.
- **Martian Mono** for timecodes, source attribution, dates, and counts. The transcript voice. Small, sparing, never for body copy.

Quotes are set large with tight leading and the highlight behind them. Everything else stays quiet.

Avoid: a high-contrast serif display on a cream field, all-caps tracked-out labels above every heading, and an arrow appended to every button. These are the current defaults of generated pages and they will make the work look automated.

### 6.5 Motion

One orchestrated moment, not scattered effects.

**The highlight sweep.** As a card enters, the mark sweeps left to right across the quote, and the text reads as being marked in front of you. Nothing else animates on entry.

Everything beyond that is response to a user action: the sheet opening, the save confirming, the mode switching from dark to light. Respect `prefers-reduced-motion` by rendering the highlight already complete.

### 6.6 Libraries

| Library | Use |
|---|---|
| Motion (formerly Framer Motion) | Gestures, layout animation, the highlight sweep |
| Vaul | Bottom sheet for "see original" and the document view |
| Lenis | Smooth scroll on the non-snapping surfaces |
| Sonner | Toasts |
| Recharts | The judge eval chart |

Aceternity User Interface (UI) and Magic UI are copy-paste Tailwind plus Motion components and are worth raiding for one or two effects. Take two, not twenty. Overusing them is the exact thing that makes a site look generated.

### 6.7 The quality floor

Responsive to mobile first, because the feed is a phone product. Visible keyboard focus. Reduced motion respected. Contrast checked, especially dark text on `--mark`.

Copy is sentence case, active voice, plain verbs. An empty state says what to do next. An error says what went wrong and how to fix it. Nothing apologizes.

---

## 7. Social layer

Young voters do not trust institutions that talk at them. The social layer is not decoration; it is how the app earns credibility with an audience that has been marketed to its entire life. But a political app with a comment section is a live grenade, so the shape matters more than the feature.

### 7.1 Comments attach to insights, not candidates

This is the single most important design decision in this section.

Comments on a candidate profile become a flame war within minutes. Comments on a specific quote ("here is what she said about housing on March 4") stay focused, because the object of discussion is a fixed, verifiable thing rather than a person.

Rules that follow:
- A comment thread belongs to one `insight_id`. There is no candidate-level or race-level thread.
- The quote is pinned at the top of every thread. Discussion happens underneath the evidence, not in place of it.
- Threads are shallow. One level of replies, no infinite nesting.

### 7.2 "Add a source" as a first-class action

Better than a comment box, and it feeds the product loop. A user can submit a Uniform Resource Locator (URL) that corroborates or contradicts an insight. Submissions run through the same ingestion pipeline as any other document, get the same quote verification, and surface on the card as community-contributed with a distinct badge.

This turns the crowd into an extraction source instead of a noise source. It is also the most defensible answer to "what if you missed something."

### 7.3 Reactions measure the insight, not the politician

Do not ship agree/disagree on a candidate's position. It converts the feed into a popularity poll, and the moment a candidate's card shows a score, every neutrality claim in this document is gone.

Ship instead:

| Reaction | Meaning |
|---|---|
| Helpful | This card told me something I could use |
| Not helpful | Vague, stale, or already obvious |
| Changed my mind | The highest-signal reaction in the app |
| Looks wrong | Routes to review, not to a public counter |

"Looks wrong" is a report path with a friendly face. It never displays a count publicly, because a visible wrongness score is trivially brigadable.

Reaction data feeds ranking. It never feeds a candidate-facing number.

### 7.4 Transparency surfaces

Transparency is the product's whole personality, so make it visible in more than one place:

- **"Why am I seeing this."** Tappable on every card. Shows in plain language: matched issue tags, recency, source count, flag status. No black-box ranking.
- **Open methodology page.** How extraction works, what the verification ladder does, what the app cannot do. Stating limits plainly builds more trust with this audience than claiming capability.
- **Public failure log.** Insights that failed quote verification, counted and visible. An app that shows its rejects is making a claim nobody can fake.
- **Source tab.** See section 2.3.

### 7.5 Other things that matter to this audience

- Never look like a government website. Dark mode default, real typography, motion that feels native.
- Zero login friction. No account to read, no account to react. Persist to local storage.
- Share as image with the quote and source baked into the graphic, so the receipt travels with the screenshot.
- Send your sample ballot to a friend. Peer comparison drives down-ballot turnout more than any prompt from an app does.
- No streaks, no gamified badges, no mascot. This audience reads those as manipulation, and here they would be.

### 7.6 Moderation

Comments on political content at a public demo will be probed. Do not leave this unhandled.

- Every comment passes through a Nemotron classification call before it renders (see 8.4).
- Categories: publish, hold for review, reject.
- Rejections show the author a reason, not a silent drop. Silent moderation is the thing this audience hates most.
- A hard rate limit per session. This kills demo-day spam at essentially zero cost.

---

## 8. NVIDIA Nemotron in the pipeline

Nemotron is not a chat surface in this project. It occupies three decision points, and one of them is load-bearing for the core promise.

### 8.1 Why a second model at all

The verification judge must not be the extractor. A model grading its own output produces grades that correlate with its own errors: if it misread a qualifier during extraction, it will misread the same qualifier while checking itself. Independence is the entire point, and independence requires a different model family.

That is the honest answer to "why did you need it," and it is an architectural reason rather than a sponsorship reason.

### 8.2 Router and triage (high volume, cheap)

GDELT returns enormous volumes of loosely relevant documents. Running full extraction on all of them is slow and expensive.

Nemotron runs first on every incoming document:
- Does this concern a candidate on any tracked ballot? If not, drop.
- Which candidate or candidates?
- Which issue tags apply?
- Is there a first-person statement present, or is this pure reporting about a person?

Only documents that clear triage reach the extraction stage. Expect this to remove the large majority of ingested documents, which is the difference between a pipeline that runs during a demo and one that does not.

### 8.3 Verification judge (the load-bearing use)

After extraction, Nemotron receives **only** the verified quote span and the claimed position. It never sees the extractor's reasoning, its confidence score, the surrounding article, or the candidate's name.

It returns a support rating:

| Rating | Meaning |
|---|---|
| 3 | The quote directly states the position |
| 2 | The quote clearly implies it |
| 1 | Related but does not establish the position |
| 0 | Does not support, or contradicts it |

Routing:
- 3 or 2: publish normally
- 1: publish with a "verify yourself" nudge instead of a stated fact
- 0: do not publish, log to the public failure count

Where the extractor's own confidence and the judge's rating disagree sharply, that disagreement is itself the signal. Surface those as low confidence rather than trying to pick a winner.

### 8.4 Classification tasks

Narrow, high-volume labeling where a dedicated call beats folding it into a large prompt:

- **Attribution.** Own words versus characterization. This is the field described in 2.3 and it is a clean binary classification.
- **Comment moderation.** Publish, hold, or reject, per 7.6.
- **Flag assignment.** Given a current insight and a prior insight on the same (candidate, issue) pair, decide `NEW`, `FLIP-FLOP`, or no change.

### 8.5 Evaluation

The track asks for evidence, and a small honest eval beats a large vague claim.

**Build a 100 item labeled set for the verification judge:**

- 60 real (quote, position) pairs pulled from the live pipeline, hand-labeled supports or does not support.
- 40 deliberately corrupted pairs, generated by three attack types:
  - **Position swap.** Keep the quote, substitute an adjacent position on the same issue.
  - **Qualifier truncation.** Cut the quote so it loses a conditional. "I would not support a rent cap without a carve-out for small landlords" becomes "I would support a rent cap." This is the most common real-world failure of quote extraction and the most important one to catch.
  - **Negation drop.** Remove a negation from the quote.

**Report three arms:**

1. No judge. Everything the extractor produces ships.
2. Self-grading. The extractor rates its own output.
3. Nemotron judge. Independent rating.

**Metrics:** precision and recall on catching corrupted pairs, plus false rejection rate on the 60 real pairs (how many good insights does the judge throw away).

**Report the failures too.** Expect the judge to struggle most on conditionals and negation, which is exactly where corrupted pairs were designed to be hardest. A track that asks for "even a failure you found" is asking you to be honest about this, and naming a specific weakness is more convincing than a clean number.

This eval is roughly an hour of work and produces a real chart.

---

## 9. Track alignment

### 9.1 Xtract track

| Requirement | How VOTR meets it |
|---|---|
| Support for different sources without rebuilding everything | One normalized `Document` interface, adapters behind it for RSS, GDELT, press releases, and transcripts. Adding a source means writing one adapter. |
| A model that finds useful signals in incoming documents | Extraction pulls positions, checkable claims, risk and opportunity framing, and change detection across time. |
| Insights that link back to where they came from | Character offset verification against stored raw text, plus timestamp offsets for video. Nothing renders without a verified span. |
| A clean way to see and use the output | Card feed, compare view, timeline, source tab, sample ballot export. |
| Public or synthetic sources only | GDELT, RSS, public press releases, publicly posted video. No proprietary data of any kind. |

The domain is civic rather than commercial, but the signal types map directly: a stance change is a competitor making a move, an unverified claim is a risk, and a candidate quietly taking a position nobody covered is something nobody has noticed yet.

**Synthetic documents.** Generate a small set of synthetic candidate statements and press releases for demo reliability. Label them clearly as synthetic in the interface and in the database. A synthetic document that is not visibly marked would violate the core promise of this app more severely than any other bug in it.

### 9.2 Nemotron track

| Requirement | How VOTR meets it |
|---|---|
| Nemotron doing something beyond conversation | Router, verification judge, and three classification tasks. No chat surface. |
| Clear explanation of what it does | Section 7, with the independence argument in 7.1. |
| Evidence that it works | The 100 item adversarial eval in 7.5, with three arms and a reported failure mode. |

These stack. Submit to both.

---

## 10. Tech stack

One language, one repository, one deploy target. Every language boundary added costs context and debugging time you do not have.

| Layer | Choice | Reason |
|---|---|---|
| App | Next.js (App Router) + TypeScript | Frontend and API routes in one project; server components read the database with no Representational State Transfer (REST) layer |
| Styling | Tailwind Cascading Style Sheets (CSS) + shadcn/ui | Component source lives in-repo, so it is editable rather than hidden behind a library API |
| Feed scrolling | Cascading Style Sheets (CSS) scroll snap | Smoother than any carousel library, about twenty lines |
| Gestures and motion | Motion (formerly Framer Motion) | Swipe to save, the highlight sweep, mode transitions |
| Sheets | Vaul | Native-feeling bottom sheet for "see original" |
| Type | Archivo + Martian Mono | See section 6.4 |
| Database | Postgres (Supabase or Neon) | Needs joins for change detection and integer offsets for quote verification |
| Object Relational Mapper (ORM) | Drizzle | Schema is plain TypeScript, no codegen step |
| Extraction Large Language Model (LLM) | Anthropic API with tool use | Structured output with a real schema contract |
| Judge, router, classifier | NVIDIA Nemotron | Independence from the extractor; cheap high-volume triage |
| Validation | Zod | One schema for prompt, database, API, and frontend types |
| Transcription | ElevenLabs Scribe | Word-level timestamps and speaker diarization |
| Voice | ElevenLabs text to speech | Briefings and accessibility |
| Share image | satori + @vercel/og | Renders a React component to Portable Network Graphics (PNG) server-side |
| Deploy | Vercel | Cron for scheduled ingestion, zero config with the above |

### Why not the alternatives

- **Python for the pipeline.** Genuinely better article extraction (trafilatura beats every JavaScript equivalent for clean article text). Cost is a second deploy and a duplicated schema at the seam. Worth it only if the Python skill gap on the team is real.
- **Expo / React Native.** Native gesture feel is noticeably better than web, and Expo Go demos on a real phone. Cost is that you now need a separate backend plus build tooling. Take this only if the swipe feel *is* the product.
- **SvelteKit.** Smaller and faster to hand-write, but if you are leaning on an artificial intelligence (AI) coding agent for volume, output quality on Svelte 5 runes is measurably worse than on React because the training data is split across a recent syntax change.

### Cut on day one

- **pgvector and embeddings.** The corpus is a few hundred documents. String matching on candidate names plus a fixed issue tag enum will outperform semantic search and takes ten minutes instead of two hours.
- **Job queues.** A single `/api/ingest` route triggered by a button or a Vercel cron is enough. Nobody at the demo will ask how it scales.
- **Authentication and accounts.** Hardcode a demo user or skip login entirely.
- **Bias scoring of sources.** Out of scope and not what this track is judging.
- **Any fine-tuned model.** Prompt-based extraction only.

---

## 11. Data model

```
districts       id, type, name, state, geo_id

races           id, district_id, office, election_date, level  -- federal | state | local

candidates      id, race_id, name, party, incumbent

documents       id, url, source_type, source_name, title,
                published_at, raw_text, fetched_at,
                media_type,          -- article | transcript
                duration_seconds,    -- transcripts only
                is_synthetic,        -- must render a visible badge
                submitted_by_user    -- community "add a source"

insights        id, document_id, candidate_id, issue_tag,
                position_text, plain_language,
                quote_char_start, quote_char_end,
                timestamp_start, timestamp_end,   -- transcripts only
                attribution,         -- own_words | characterization
                flag,                -- NEW | FLIP_FLOP | UNVERIFIED_CLAIM | null
                extractor_confidence,
                judge_rating,        -- Nemotron, 0 to 3
                status,              -- published | verify_yourself | rejected
                created_at

stance_links    id, insight_id, prior_insight_id, relation

reactions       id, insight_id, session_id, kind
                -- helpful | not_helpful | changed_my_mind | looks_wrong

comments        id, insight_id, session_id, body,
                moderation_status,   -- publish | hold | reject
                moderation_reason, parent_id, created_at

rejections      id, document_id, reason, created_at
                -- powers the public failure log
```

Note `quote_char_start` and `quote_char_end` rather than a stored quote string. The quote is always rendered by slicing the raw document, which means it cannot drift from its source.

`session_id` carries reactions and comments without accounts. Generate it client-side, persist to local storage, no login.

---

## 12. Risks

**Local data thinness.** Most local candidates will have almost no sources. Budget real time for deciding what a profile looks like with three documents behind it. Showing thinness honestly is better than hiding it.

**Neutrality perception.** Whatever you build, someone will read the output as biased. The defense is that every statement is a quote with a link. Lean on it hard in the interface. The moment a card contains a sentence that is not traceable, the argument is lost.

**Speaker misattribution in debates.** Handled by diarization, but verify it on real multi-speaker audio early. An insight attributed to the wrong candidate is worse than no insight.

**Scope.** Federal plus state plus local plus ballot measures plus voting logistics plus video is more than a hackathon.

**The comment section at a live demo.** Assume someone will try to post something ugly while judges are watching. Moderation plus rate limiting is not a nice-to-have here, it is table stakes for shipping the feature at all. If moderation is not working by the deadline, ship the app with comments disabled rather than with comments open.

**Synthetic documents leaking as real.** A synthetic press release rendered without its badge is the worst possible bug in this specific app. Enforce the badge at the component level, not at the data level, so it cannot be forgotten.

---

## 13. Build order

1. Document ingestion (RSS and GDELT) into Postgres with raw text stored
2. Nemotron triage router, so the pipeline stops drowning in irrelevant documents
3. Extraction with Zod-validated tool use
4. **Quote verification with character offsets.** Nothing else ships until this is airtight.
5. Nemotron verification judge plus routing on the rating
6. Card feed rendering from verified insights, with the design tokens and type in place from the start
7. Address to district resolution
8. Voting mechanics tab
9. Source tab and "why am I seeing this"
10. Scribe transcription and timestamp jump
11. Change detection second pass
12. Reactions, then comments with moderation
13. Judge eval, three arms, one chart
14. Audio briefing
15. Compare view, share image, timeline, add-a-source
16. Conversational agent, only if hours remain

The eval at step 13 is a submission requirement for the Nemotron track, not a stretch goal. Do not let it slide behind polish work.

## 14. Demo plan

One competitive House race plus the local races in one real district, fully populated, with airtight sourcing. That lands better than six races half-built.

The closing beat, in order:

1. Tap "see original" on a stance card. The video opens at the exact second the candidate says it.
2. Open the source tab. Show exactly where the whole profile came from, and which parts are the candidate's own words versus a reporter's characterization.
3. Open the public failure log. Show the insights the judge rejected and why. An app that shows its rejects is making a claim nobody can fake, and it is the moment that separates this from an aggregator with a nice feed.
