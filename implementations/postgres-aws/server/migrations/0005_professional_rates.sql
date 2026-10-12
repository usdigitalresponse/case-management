CREATE TABLE "professional_rate" (
	"professional_rate_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"hourly_rate" numeric(12, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"recorded_by_user_account_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "stated_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "billed_rate" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "professional_rate" ADD CONSTRAINT "professional_rate_professional_id_professional_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("professional_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_rate" ADD CONSTRAINT "professional_rate_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "professional_rate_professional_idx" ON "professional_rate" USING btree ("professional_id","effective_from");