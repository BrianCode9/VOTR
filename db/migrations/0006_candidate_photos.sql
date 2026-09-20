CREATE TABLE "candidate_photos" (
	"candidate_id" uuid PRIMARY KEY NOT NULL,
	"image_url" text NOT NULL,
	"source_page" text NOT NULL,
	"file_page" text NOT NULL,
	"creator" text,
	"license_name" text NOT NULL,
	"license_url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_photos" ADD CONSTRAINT "candidate_photos_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;