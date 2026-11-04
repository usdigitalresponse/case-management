-- Travel time settings become settings per category of time: travel or waiting.
ALTER TABLE "travel_time_rate" RENAME TO "time_category_rate";--> statement-breakpoint
ALTER TABLE "time_category_rate" RENAME COLUMN "travel_time_rate_id" TO "time_category_rate_id";--> statement-breakpoint
ALTER TABLE "time_category_rate" RENAME CONSTRAINT "travel_time_rate_recorded_by_user_account_id_user_account_user_account_id_fk" TO "time_category_rate_recorded_by_user_account_id_user_account_user_account_id_fk";--> statement-breakpoint
ALTER TABLE "time_category_rate" ADD COLUMN "category" text DEFAULT 'travel' NOT NULL;--> statement-breakpoint
ALTER TABLE "time_category_rate" ALTER COLUMN "category" DROP DEFAULT;--> statement-breakpoint
DROP INDEX "travel_time_rate_effective_idx";--> statement-breakpoint
CREATE INDEX "time_category_rate_effective_idx" ON "time_category_rate" USING btree ("category","effective_from");--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "time_category" text;
