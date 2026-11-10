CREATE TABLE "case_rate" (
	"case_rate_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"professional_id" uuid,
	"professional_kind_id" uuid,
	"rate_type" text NOT NULL,
	"rate" numeric(12, 3),
	"replaced_rate" numeric(12, 3),
	"effective_from" date NOT NULL,
	"reason_id" uuid NOT NULL,
	"note" text,
	"invoice_id" uuid NOT NULL,
	"corrects_case_rate_id" uuid,
	"recorded_by_user_account_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "case_rate_one_target" CHECK (num_nonnulls("case_rate"."professional_id", "case_rate"."professional_kind_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "rate_source" text;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "case_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "case_rate" ADD CONSTRAINT "case_rate_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_rate" ADD CONSTRAINT "case_rate_professional_id_professional_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("professional_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_rate" ADD CONSTRAINT "case_rate_professional_kind_id_professional_kinds_id_fk" FOREIGN KEY ("professional_kind_id") REFERENCES "public"."professional_kinds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_rate" ADD CONSTRAINT "case_rate_reason_id_invoice_decision_reasons_id_fk" FOREIGN KEY ("reason_id") REFERENCES "public"."invoice_decision_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_rate" ADD CONSTRAINT "case_rate_invoice_id_invoice_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_rate" ADD CONSTRAINT "case_rate_corrects_case_rate_id_case_rate_case_rate_id_fk" FOREIGN KEY ("corrects_case_rate_id") REFERENCES "public"."case_rate"("case_rate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_rate" ADD CONSTRAINT "case_rate_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_rate_case_idx" ON "case_rate" USING btree ("case_id","effective_from");--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_case_rate_id_case_rate_case_rate_id_fk" FOREIGN KEY ("case_rate_id") REFERENCES "public"."case_rate"("case_rate_id") ON DELETE no action ON UPDATE no action;