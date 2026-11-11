CREATE TABLE "person_duplicate_review" (
	"person_duplicate_review_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"other_person_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"note" text,
	"recorded_by_user_account_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "person_duplicate_review_ordered_pair" CHECK ("person_duplicate_review"."person_id" < "person_duplicate_review"."other_person_id"),
	CONSTRAINT "person_duplicate_review_outcome" CHECK ("person_duplicate_review"."outcome" in ('possible_duplicate', 'not_duplicate'))
);
--> statement-breakpoint
CREATE TABLE "person_merge" (
	"person_merge_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kept_person_id" uuid NOT NULL,
	"retired_person_id" uuid NOT NULL,
	"note" text,
	"merged_by_user_account_id" uuid NOT NULL,
	"merged_at" timestamp with time zone NOT NULL,
	"undone_by_user_account_id" uuid,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "person_merge_change" (
	"person_merge_change_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_merge_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"table_name" text NOT NULL,
	"column_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"from_value" text,
	"to_value" text
);
--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "merged_into_person_id" uuid;--> statement-breakpoint
ALTER TABLE "person_duplicate_review" ADD CONSTRAINT "person_duplicate_review_person_id_person_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_duplicate_review" ADD CONSTRAINT "person_duplicate_review_other_person_id_person_person_id_fk" FOREIGN KEY ("other_person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_duplicate_review" ADD CONSTRAINT "person_duplicate_review_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merge" ADD CONSTRAINT "person_merge_kept_person_id_person_person_id_fk" FOREIGN KEY ("kept_person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merge" ADD CONSTRAINT "person_merge_retired_person_id_person_person_id_fk" FOREIGN KEY ("retired_person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merge" ADD CONSTRAINT "person_merge_merged_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("merged_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merge" ADD CONSTRAINT "person_merge_undone_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("undone_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merge_change" ADD CONSTRAINT "person_merge_change_person_merge_id_person_merge_person_merge_id_fk" FOREIGN KEY ("person_merge_id") REFERENCES "public"."person_merge"("person_merge_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_duplicate_review_pair_idx" ON "person_duplicate_review" USING btree ("person_id","other_person_id","recorded_at");--> statement-breakpoint
CREATE INDEX "person_merge_merged_at_idx" ON "person_merge" USING btree ("merged_at");--> statement-breakpoint
CREATE INDEX "person_merge_change_merge_idx" ON "person_merge_change" USING btree ("person_merge_id");--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_merged_into_person_id_person_person_id_fk" FOREIGN KEY ("merged_into_person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;