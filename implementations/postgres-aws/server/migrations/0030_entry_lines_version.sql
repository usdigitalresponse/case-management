ALTER TABLE "invoice" ADD COLUMN "lines_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "lines_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "lines_changed_by_user_account_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_lines_changed_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("lines_changed_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;