-- Confidence scoring, source diversity, and speaker identity.
--
-- Fully additive. No column is dropped, narrowed, or made NOT NULL without a
-- default, and every new column on `insights` either is nullable or has one.
-- Rows written before this migration keep working unchanged, and so does every
-- existing endpoint.
--
-- Three things this migration does NOT do, on purpose:
--
--   1. It does not populate `speakers`, and it does not set `speaker_id` on
--      `candidates` or `insights`. Identity matching is the TypeScript
--      function in lib/speakers/normalize.ts, and a second copy of those rules
--      written in SQL would drift from it on the first title nobody thought
--      of. `npm run backfill` does it with the real function, is idempotent,
--      and is safe to re-run.
--   2. It does not compute corroboration. Every insight starts at
--      `corroboration_count = 1`, meaning "one outlet, nothing has confirmed
--      it", which is the honest state before the pass has looked.
--      `npm run corroborate` fills it in; new documents maintain it
--      incrementally from then on.
--   3. It does not touch `insight_status`, whose `verify_yourself` VALUE is a
--      different thing from the new `verify_yourself` COLUMN. The status
--      routes a row away from the feed; the column is about how a published
--      row is worded. See the note in db/schema.ts.

CREATE TYPE "public"."confidence_label" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."presentation_mode" AS ENUM('stated', 'nudge_verify');--> statement-breakpoint
CREATE TABLE "insight_corroborations" (
	"insight_id" uuid NOT NULL,
	"corroborating_insight_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"match_score" real DEFAULT 0 NOT NULL,
	"match_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "speakers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"normalized_aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"party" text,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "speaker_id" uuid;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "speaker_id" uuid;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "claim_support_confidence" real;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "confidence_label" "confidence_label" DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "verify_yourself" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "presentation_mode" "presentation_mode" DEFAULT 'stated' NOT NULL;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "corroboration_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "corroborating_source_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "corroboration_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "insight_corroborations" ADD CONSTRAINT "insight_corroborations_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_corroborations" ADD CONSTRAINT "insight_corroborations_corroborating_insight_id_insights_id_fk" FOREIGN KEY ("corroborating_insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_corroborations" ADD CONSTRAINT "insight_corroborations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "insight_corroborations_key" ON "insight_corroborations" USING btree ("insight_id","corroborating_insight_id");--> statement-breakpoint
CREATE INDEX "insight_corroborations_insight_idx" ON "insight_corroborations" USING btree ("insight_id");--> statement-breakpoint
CREATE INDEX "insight_corroborations_other_idx" ON "insight_corroborations" USING btree ("corroborating_insight_id");--> statement-breakpoint
CREATE INDEX "insight_corroborations_source_idx" ON "insight_corroborations" USING btree ("insight_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "speakers_normalized_name_key" ON "speakers" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "speakers_aliases_idx" ON "speakers" USING gin ("normalized_aliases");--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_speaker_id_speakers_id_fk" FOREIGN KEY ("speaker_id") REFERENCES "public"."speakers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_speaker_id_speakers_id_fk" FOREIGN KEY ("speaker_id") REFERENCES "public"."speakers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidates_speaker_idx" ON "candidates" USING btree ("speaker_id");--> statement-breakpoint
CREATE INDEX "insights_speaker_issue_idx" ON "insights" USING btree ("speaker_id","issue_tag");--> statement-breakpoint
CREATE INDEX "insights_speaker_created_idx" ON "insights" USING btree ("speaker_id","created_at","id");--> statement-breakpoint
CREATE INDEX "insights_confidence_idx" ON "insights" USING btree ("confidence_label","created_at","id");--> statement-breakpoint
CREATE INDEX "insights_corroboration_idx" ON "insights" USING btree ("corroboration_count","id");
--> statement-breakpoint
-- Backfill the confidence columns from what the existing rows already carry.
--
-- `extractor_confidence` is the quote-to-position support rating for `stance`
-- rows and nothing else: for `stance_change` it rates whether a change of
-- position occurred, and for the other two `flattenExtraction` stored a
-- constant 1 because those families were never asked the question. So the
-- literal copy is made for stances only, where the two quantities are the same
-- quantity, and the rest keep a null score meaning "never rated".
UPDATE "insights"
   SET "claim_support_confidence" = "extractor_confidence"
 WHERE "card_type" = 'stance'
   AND "extractor_confidence" IS NOT NULL;--> statement-breakpoint

-- The label, though, is derived for every row that has any rating at all,
-- including the approximate ones. A legacy row with no label would sort and
-- filter as `medium` by column default while carrying a score that says
-- otherwise, and a feed that disagrees with itself is worse than a label that
-- is approximate and documented.
--
-- The cut points are the defaults in lib/confidence/score.ts (high >= 0.8,
-- medium >= 0.5, low below). They are repeated here rather than imported
-- because a migration has to keep meaning what it meant on the day it ran,
-- even after someone moves the constant.
UPDATE "insights"
   SET "confidence_label" = CASE
         WHEN COALESCE("claim_support_confidence", "extractor_confidence") >= 0.8 THEN 'high'
         WHEN COALESCE("claim_support_confidence", "extractor_confidence") >= 0.5 THEN 'medium'
         ELSE 'low'
       END::"public"."confidence_label"
 WHERE COALESCE("claim_support_confidence", "extractor_confidence") IS NOT NULL;--> statement-breakpoint

-- The flag and the mode are functions of the label, so they are derived from
-- the column just written rather than from the score a second time. Two
-- derivations of one rule is how a row ends up flagged `low` and presented as
-- `stated`.
UPDATE "insights"
   SET "verify_yourself" = ("confidence_label" = 'low'),
       "presentation_mode" = CASE
         WHEN "confidence_label" = 'low' THEN 'nudge_verify'
         ELSE 'stated'
       END::"public"."presentation_mode";--> statement-breakpoint

-- Every existing insight came from exactly one outlet and nothing has checked
-- it against another, which is what `corroboration_count = 1` already says.
-- The source list is filled in so the two agree: a count of 1 with an empty
-- array would read as "one source, unknown which".
UPDATE "insights" i
   SET "corroborating_source_ids" = ARRAY[
         NULLIF(BTRIM(LOWER(d."source_name")), '')
       ]::text[]
  FROM "documents" d
 WHERE d."id" = i."document_id"
   AND CARDINALITY(i."corroborating_source_ids") = 0
   AND BTRIM(d."source_name") <> '';
