CREATE TABLE "professional_invoice_reviewer" (
	"professional_invoice_reviewer_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"reviewer_user_account_id" uuid NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	"set_by_user_account_id" uuid NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "professional_rate" (
	"professional_rate_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"hourly_rate" numeric(12, 2),
	"rate_per_mile" numeric(8, 3),
	"effective_from" date NOT NULL,
	"recorded_by_user_account_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "case_number_corrected" text;--> statement-breakpoint
ALTER TABLE "professional" ADD COLUMN "paid_through" text;--> statement-breakpoint
ALTER TABLE "professional" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "professional_invoice_reviewer" ADD CONSTRAINT "professional_invoice_reviewer_professional_id_professional_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("professional_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_invoice_reviewer" ADD CONSTRAINT "professional_invoice_reviewer_reviewer_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("reviewer_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_invoice_reviewer" ADD CONSTRAINT "professional_invoice_reviewer_set_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("set_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_rate" ADD CONSTRAINT "professional_rate_professional_id_professional_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("professional_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_rate" ADD CONSTRAINT "professional_rate_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "professional_invoice_reviewer_open_uidx" ON "professional_invoice_reviewer" USING btree ("professional_id") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE INDEX "professional_rate_professional_idx" ON "professional_rate" USING btree ("professional_id","effective_from");