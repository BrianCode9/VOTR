-- Card types, verification status, and the feed's ranking columns.
--
-- Additive except for one relaxation: insights.candidate_id becomes nullable,
-- because a factual claim or a voter-relevant risk often comes from a document
-- that names no candidate.
--
-- Rows that predate this migration are backfilled to card_type 'stance' and
-- quote_verified 'exact'. The first is exactly what they are. The second is an
-- assumption: the rung was not recorded before this column existed and cannot
-- be recovered from the stored offsets. Re-running extraction over those
-- documents is what replaces the assumption with a measurement.
CREATE TYPE "public"."insight_card_type" AS ENUM('stance', 'stance_change', 'factual_claim', 'voter_relevance');--> statement-breakpoint
CREATE TYPE "public"."quote_verified" AS ENUM('exact', 'normalized', 'transcript', 'fuzzy');--> statement-breakpoint
ALTER TABLE "insights" ALTER COLUMN "candidate_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "raw_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "card_type" "insight_card_type" DEFAULT 'stance' NOT NULL;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "quote_verified" "quote_verified" DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "quote_similarity" real;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "relevance_score" real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "insights_feed_recent_idx" ON "insights" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "insights_feed_relevance_idx" ON "insights" USING btree ("relevance_score","id");--> statement-breakpoint
CREATE UNIQUE INDEX "insights_dedup_key" ON "insights" USING btree ("document_id","quote_char_start","quote_char_end","card_type");