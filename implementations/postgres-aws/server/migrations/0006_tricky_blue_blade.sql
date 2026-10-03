CREATE TABLE "invoice_approval_chain" (
	"invoice_approval_chain_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"created_by_user_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoice_approval_decision" (
	"invoice_approval_decision_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_approval_chain_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"step_type_id" uuid NOT NULL,
	"invoice_line_id" uuid,
	"outcome_id" uuid NOT NULL,
	"decided_by_user_account_id" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "invoice_approval_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "invoice_approval_outcomes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "invoice_approval_step_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "invoice_approval_step_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "invoice_approval_chain" ADD CONSTRAINT "invoice_approval_chain_invoice_id_invoice_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_approval_chain" ADD CONSTRAINT "invoice_approval_chain_created_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("created_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_approval_decision" ADD CONSTRAINT "invoice_approval_decision_invoice_approval_chain_id_invoice_approval_chain_invoice_approval_chain_id_fk" FOREIGN KEY ("invoice_approval_chain_id") REFERENCES "public"."invoice_approval_chain"("invoice_approval_chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_approval_decision" ADD CONSTRAINT "invoice_approval_decision_step_type_id_invoice_approval_step_types_id_fk" FOREIGN KEY ("step_type_id") REFERENCES "public"."invoice_approval_step_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_approval_decision" ADD CONSTRAINT "invoice_approval_decision_invoice_line_id_invoice_line_invoice_line_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_line"("invoice_line_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_approval_decision" ADD CONSTRAINT "invoice_approval_decision_outcome_id_invoice_approval_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."invoice_approval_outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_approval_decision" ADD CONSTRAINT "invoice_approval_decision_decided_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("decided_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;