CREATE TYPE "public"."attribution" AS ENUM('own_words', 'characterization');--> statement-breakpoint
CREATE TYPE "public"."district_level" AS ENUM('federal', 'state', 'local');--> statement-breakpoint
CREATE TYPE "public"."insight_flag" AS ENUM('NEW', 'FLIP_FLOP', 'UNVERIFIED_CLAIM');--> statement-breakpoint
CREATE TYPE "public"."insight_status" AS ENUM('published', 'verify_yourself', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('article', 'transcript');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('publish', 'hold', 'reject');--> statement-breakpoint
CREATE TYPE "public"."reaction_kind" AS ENUM('helpful', 'not_helpful', 'changed_my_mind', 'looks_wrong');--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"name" text NOT NULL,
	"party" text,
	"incumbent" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insight_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"body" text NOT NULL,
	"moderation_status" "moderation_status" DEFAULT 'hold' NOT NULL,
	"moderation_reason" text,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"geo_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"source_type" text NOT NULL,
	"source_name" text NOT NULL,
	"title" text NOT NULL,
	"published_at" timestamp with time zone,
	"raw_text" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"media_type" "media_type" NOT NULL,
	"duration_seconds" integer,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"submitted_by_user" text
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"issue_tag" text NOT NULL,
	"position_text" text NOT NULL,
	"plain_language" text NOT NULL,
	"quote_char_start" integer NOT NULL,
	"quote_char_end" integer NOT NULL,
	"timestamp_start" real,
	"timestamp_end" real,
	"attribution" "attribution" NOT NULL,
	"flag" "insight_flag",
	"extractor_confidence" real,
	"judge_rating" integer,
	"status" "insight_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"district_id" uuid NOT NULL,
	"office" text NOT NULL,
	"election_date" timestamp with time zone NOT NULL,
	"level" "district_level" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insight_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"kind" "reaction_kind" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rejections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stance_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insight_id" uuid NOT NULL,
	"prior_insight_id" uuid NOT NULL,
	"relation" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejections" ADD CONSTRAINT "rejections_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stance_links" ADD CONSTRAINT "stance_links_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stance_links" ADD CONSTRAINT "stance_links_prior_insight_id_insights_id_fk" FOREIGN KEY ("prior_insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidates_race_idx" ON "candidates" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "comments_insight_idx" ON "comments" USING btree ("insight_id");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "districts_geo_id_key" ON "districts" USING btree ("geo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_url_key" ON "documents" USING btree ("url");--> statement-breakpoint
CREATE INDEX "documents_published_idx" ON "documents" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "insights_candidate_issue_idx" ON "insights" USING btree ("candidate_id","issue_tag");--> statement-breakpoint
CREATE INDEX "insights_document_idx" ON "insights" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "insights_status_idx" ON "insights" USING btree ("status");--> statement-breakpoint
CREATE INDEX "races_district_idx" ON "races" USING btree ("district_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_unique" ON "reactions" USING btree ("insight_id","session_id","kind");--> statement-breakpoint
CREATE INDEX "reactions_insight_idx" ON "reactions" USING btree ("insight_id");--> statement-breakpoint
CREATE INDEX "rejections_document_idx" ON "rejections" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "stance_links_insight_idx" ON "stance_links" USING btree ("insight_id");