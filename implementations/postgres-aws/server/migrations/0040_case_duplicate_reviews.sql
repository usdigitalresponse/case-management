CREATE TABLE "case_duplicate_review" (
	"case_duplicate_review_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"other_case_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"note" text,
	"recorded_by_user_account_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "case_duplicate_review_ordered_pair" CHECK ("case_duplicate_review"."case_id" < "case_duplicate_review"."other_case_id"),
	CONSTRAINT "case_duplicate_review_outcome" CHECK ("case_duplicate_review"."outcome" in ('possible_duplicate', 'not_duplicate'))
);
--> statement-breakpoint
ALTER TABLE "case_duplicate_review" ADD CONSTRAINT "case_duplicate_review_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_duplicate_review" ADD CONSTRAINT "case_duplicate_review_other_case_id_case_case_id_fk" FOREIGN KEY ("other_case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_duplicate_review" ADD CONSTRAINT "case_duplicate_review_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_duplicate_review_pair_idx" ON "case_duplicate_review" USING btree ("case_id","other_case_id","recorded_at");