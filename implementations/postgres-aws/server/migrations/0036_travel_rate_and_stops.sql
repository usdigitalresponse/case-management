CREATE TABLE "mileage_warning_dismissal" (
	"mileage_warning_dismissal_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"dismissed" boolean NOT NULL,
	"reason" text,
	"recorded_by_user_account_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "professional_rate" ADD COLUMN "travel_hourly_rate" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "mileage_warning_dismissal" ADD CONSTRAINT "mileage_warning_dismissal_invoice_id_invoice_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mileage_warning_dismissal" ADD CONSTRAINT "mileage_warning_dismissal_invoice_line_id_invoice_line_invoice_line_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_line"("invoice_line_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mileage_warning_dismissal" ADD CONSTRAINT "mileage_warning_dismissal_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mileage_warning_dismissal_invoice_idx" ON "mileage_warning_dismissal" USING btree ("invoice_id");