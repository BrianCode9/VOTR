-- "What changed" flags, plain-language rewrites, the topic taxonomy, reader
-- profiles, saves, and share cards.
--
-- Fully additive: no column is dropped, narrowed, or made NOT NULL, and every
-- new column on `insights` is either nullable or has a default. Rows written
-- before this migration keep working unchanged.
--
-- Two things this migration does NOT do, on purpose:
--
--   1. It does not seed the `topics` table. The taxonomy is data, and its seed
--      lives in lib/topics/taxonomy.ts so it can be re-run and extended
--      without a migration. Run `npm run seed:topics` after migrating.
--   2. It does not backfill `insight_topics`, because that backfill needs the
--      seeded topic rows to join against. The same seed script does it, and it
--      is idempotent.
--
-- The one backfill here is `insights.flags`, which is derived purely from the
-- existing `flag` column and so needs nothing external. `flag` is kept as a
-- mirror of flags[0] for the card component that already reads it.

CREATE TYPE "public"."fact_check_status" AS ENUM('unresolved', 'supported', 'disputed', 'false');--> statement-breakpoint
CREATE TABLE "insight_topics" (
	"insight_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_topics" (
	"profile_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"insight_id" uuid NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insight_id" uuid NOT NULL,
	"template" text NOT NULL,
	"content_type" text NOT NULL,
	"encoding" text DEFAULT 'utf8' NOT NULL,
	"body" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "plain_language_summary" text;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "reading_level_estimate" real;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "flags" "insight_flag"[] DEFAULT '{}'::insight_flag[] NOT NULL;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "fact_check_status" "fact_check_status" DEFAULT 'unresolved' NOT NULL;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "fact_check_source" text;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "fact_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "insight_topics" ADD CONSTRAINT "insight_topics_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_topics" ADD CONSTRAINT "insight_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_topics" ADD CONSTRAINT "profile_topics_profile_id_user_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_topics" ADD CONSTRAINT "profile_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_insights" ADD CONSTRAINT "saved_insights_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_images" ADD CONSTRAINT "share_images_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "insight_topics_key" ON "insight_topics" USING btree ("insight_id","topic_id");--> statement-breakpoint
CREATE INDEX "insight_topics_topic_idx" ON "insight_topics" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_topics_key" ON "profile_topics" USING btree ("profile_id","topic_id");--> statement-breakpoint
CREATE INDEX "profile_topics_profile_idx" ON "profile_topics" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_insights_key" ON "saved_insights" USING btree ("user_id","insight_id");--> statement-breakpoint
CREATE INDEX "saved_insights_user_idx" ON "saved_insights" USING btree ("user_id","saved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "share_images_key" ON "share_images" USING btree ("insight_id","template");--> statement-breakpoint
CREATE INDEX "share_images_insight_idx" ON "share_images" USING btree ("insight_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_slug_key" ON "topics" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "topics_active_idx" ON "topics" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "user_profiles_user_key" ON "user_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "insights_flags_idx" ON "insights" USING gin ("flags");--> statement-breakpoint
-- Carry the existing single badge into the array. Rows with no badge keep the
-- '{}' default, which is the correct value for "carries no badges".
UPDATE "insights" SET "flags" = ARRAY["flag"] WHERE "flag" IS NOT NULL;
