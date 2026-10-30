ALTER TABLE "invoice" ADD COLUMN "proposed_case" jsonb;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "proposed_provider" jsonb;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "proposed_timekeeper_name" text;