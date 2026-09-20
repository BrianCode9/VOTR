CREATE TABLE "candidate_sources" (
	"source_key" text PRIMARY KEY NOT NULL,
	"candidate_id" uuid NOT NULL,
	"election_stage" text NOT NULL,
	"candidacy_status" text NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text NOT NULL,
	"source_record" jsonb NOT NULL,
	"incumbent_known" boolean NOT NULL,
	"campaign_website" text,
	"biography" text,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_sources" ADD CONSTRAINT "candidate_sources_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_sources_candidate_idx" ON "candidate_sources" USING btree ("candidate_id");