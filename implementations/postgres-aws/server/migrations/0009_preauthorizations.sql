CREATE TABLE "preauthorization" (
	"preauthorization_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"professional_id" uuid,
	"status_id" uuid NOT NULL,
	"requested_amount" numeric(12, 2),
	"requested_at" timestamp with time zone NOT NULL,
	"authorization_number" text,
	"currency_code" text DEFAULT 'USD' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preauthorization_decision" (
	"preauthorization_decision_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preauthorization_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"outcome_id" uuid NOT NULL,
	"approved_amount" numeric(12, 2),
	"effective_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"decided_by_user_account_id" uuid NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "preauthorization_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "preauthorization_outcomes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "preauthorization_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "preauthorization_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "preauthorization" ADD CONSTRAINT "preauthorization_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization" ADD CONSTRAINT "preauthorization_professional_id_professional_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("professional_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization" ADD CONSTRAINT "preauthorization_status_id_preauthorization_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."preauthorization_statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_decision" ADD CONSTRAINT "preauthorization_decision_preauthorization_id_preauthorization_preauthorization_id_fk" FOREIGN KEY ("preauthorization_id") REFERENCES "public"."preauthorization"("preauthorization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_decision" ADD CONSTRAINT "preauthorization_decision_outcome_id_preauthorization_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."preauthorization_outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_decision" ADD CONSTRAINT "preauthorization_decision_decided_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("decided_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "preauthorization_case_idx" ON "preauthorization" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preauthorization_decision_sequence_uidx" ON "preauthorization_decision" USING btree ("preauthorization_id","sequence_number");