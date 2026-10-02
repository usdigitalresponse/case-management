CREATE TABLE "activity_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "activity_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"invoice_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submitted_by_user_account_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"status_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_total" numeric(12, 2) NOT NULL,
	"case_id" uuid NOT NULL,
	"currency_code" text DEFAULT 'USD' NOT NULL,
	"period_start" date,
	"period_end" date
);
--> statement-breakpoint
CREATE TABLE "invoice_line" (
	"invoice_line_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"line_type_id" uuid NOT NULL,
	"source_time_entry_id" uuid,
	"amount" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "invoice_line_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "invoice_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "invoice_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "time_entry" (
	"time_entry_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"activity_type_id" uuid NOT NULL,
	"activity_on" date NOT NULL,
	"duration_hours" numeric(6, 2) NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_submitted_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("submitted_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_professional_id_professional_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("professional_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_status_id_invoice_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."invoice_statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_invoice_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_line_type_id_invoice_line_types_id_fk" FOREIGN KEY ("line_type_id") REFERENCES "public"."invoice_line_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_source_time_entry_id_time_entry_time_entry_id_fk" FOREIGN KEY ("source_time_entry_id") REFERENCES "public"."time_entry"("time_entry_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_professional_id_professional_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("professional_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_professional_id_idx" ON "invoice" USING btree ("professional_id");--> statement-breakpoint
CREATE INDEX "invoice_case_id_idx" ON "invoice" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "invoice_line_invoice_id_idx" ON "invoice_line" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "time_entry_case_id_idx" ON "time_entry" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "time_entry_professional_id_idx" ON "time_entry" USING btree ("professional_id");