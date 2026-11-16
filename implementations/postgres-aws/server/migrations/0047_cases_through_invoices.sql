CREATE TABLE "case_correction" (
	"case_correction_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"kept_case_id" uuid,
	"corrected_by_user_account_id" uuid NOT NULL,
	"corrected_at" timestamp with time zone NOT NULL,
	"undone_by_user_account_id" uuid,
	"undone_at" timestamp with time zone,
	CONSTRAINT "case_correction_kind_check" CHECK ("case_correction"."kind" in ('same_case', 'corrected', 'not_for_case'))
);
--> statement-breakpoint
CREATE TABLE "case_correction_change" (
	"case_correction_change_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_correction_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"table_name" text NOT NULL,
	"column_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"from_value" text,
	"to_value" text
);
--> statement-breakpoint
ALTER TABLE "case" ADD COLUMN "added_from_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "case" ADD COLUMN "added_from_preauthorization_request_id" uuid;--> statement-breakpoint
ALTER TABLE "case" ADD COLUMN "closed_as_mistake" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "case_choice" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "chosen_case_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "new_case_client_name" text;--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD COLUMN "not_for_case" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD COLUMN "county_id" uuid;--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD COLUMN "approved_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD COLUMN "approved_hourly_rate" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "case_correction" ADD CONSTRAINT "case_correction_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_correction" ADD CONSTRAINT "case_correction_kept_case_id_case_case_id_fk" FOREIGN KEY ("kept_case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_correction" ADD CONSTRAINT "case_correction_corrected_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("corrected_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_correction" ADD CONSTRAINT "case_correction_undone_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("undone_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_correction_change" ADD CONSTRAINT "case_correction_change_case_correction_id_case_correction_case_correction_id_fk" FOREIGN KEY ("case_correction_id") REFERENCES "public"."case_correction"("case_correction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_correction_case_idx" ON "case_correction" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_correction_change_correction_idx" ON "case_correction_change" USING btree ("case_correction_id");--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "case_added_from_invoice_id_invoice_invoice_id_fk" FOREIGN KEY ("added_from_invoice_id") REFERENCES "public"."invoice"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "case_added_from_preauthorization_request_id_preauthorization_request_preauthorization_request_id_fk" FOREIGN KEY ("added_from_preauthorization_request_id") REFERENCES "public"."preauthorization_request"("preauthorization_request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_chosen_case_id_case_case_id_fk" FOREIGN KEY ("chosen_case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD CONSTRAINT "preauthorization_request_county_id_county_county_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."county"("county_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_case_choice_check" CHECK ("invoice"."case_choice" in ('existing', 'new', 'none'));--> statement-breakpoint
-- A request matched before the case question existed was for that case.
UPDATE "invoice" SET "case_choice" = 'existing' WHERE "case_id" IS NOT NULL;
