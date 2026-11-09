CREATE TABLE "review_time_log" (
	"review_time_log_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"rows" jsonb NOT NULL,
	"header_row" integer NOT NULL,
	"columns" jsonb NOT NULL,
	"worker_matches" jsonb NOT NULL,
	"line_links" jsonb NOT NULL,
	"uploaded_by_user_account_id" uuid NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "review_time_log_invoice_id_unique" UNIQUE("invoice_id")
);
--> statement-breakpoint
ALTER TABLE "review_time_log" ADD CONSTRAINT "review_time_log_invoice_id_invoice_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_time_log" ADD CONSTRAINT "review_time_log_uploaded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("uploaded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;
