CREATE TABLE "document_link" (
	"document_link_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"case_id" uuid,
	"invoice_id" uuid,
	"preauthorization_id" uuid,
	"preauthorization_request_id" uuid,
	"professional_id" uuid,
	"purpose_id" uuid NOT NULL,
	CONSTRAINT "document_link_one_target" CHECK (num_nonnulls("document_link"."case_id", "document_link"."invoice_id", "document_link"."preauthorization_id", "document_link"."preauthorization_request_id", "document_link"."professional_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "document_purposes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "document_purposes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "invoice_overrun_explanation" (
	"invoice_overrun_explanation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_approval_chain_id" uuid,
	"professional_id" uuid NOT NULL,
	"limit_amount" numeric(12, 2) NOT NULL,
	"limit_source" text NOT NULL,
	"total_with_request" numeric(12, 2) NOT NULL,
	"explanation" text NOT NULL,
	"recorded_by_user_account_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preauthorization_question" (
	"preauthorization_question_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preauthorization_request_id" uuid NOT NULL,
	"question" text NOT NULL,
	"asked_by_user_account_id" uuid NOT NULL,
	"asked_at" timestamp with time zone NOT NULL,
	"answer" text,
	"answered_by_user_account_id" uuid,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "preauthorization_request" (
	"preauthorization_request_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_number" text NOT NULL,
	"case_id" uuid,
	"professional_id" uuid,
	"proposed_details" jsonb,
	"preauthorization_id" uuid,
	"professional_kind_id" uuid,
	"service_description" text NOT NULL,
	"rate_basis" text NOT NULL,
	"requested_rate" numeric(12, 2),
	"estimated_quantity" numeric(10, 2),
	"requested_amount" numeric(12, 2) NOT NULL,
	"justification" text NOT NULL,
	"currency_code" text DEFAULT 'USD' NOT NULL,
	"status_id" uuid NOT NULL,
	"requested_by_user_account_id" uuid NOT NULL,
	"requested_for_person_id" uuid,
	"received_via" text,
	"received_at" timestamp with time zone NOT NULL,
	"outcome_id" uuid,
	"decision_reason" text,
	"preauthorization_decision_id" uuid,
	"decided_by_user_account_id" uuid,
	"decided_at" timestamp with time zone,
	"withdrawn_by_user_account_id" uuid,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "preauthorization_request_request_number_unique" UNIQUE("request_number")
);
--> statement-breakpoint
CREATE TABLE "preauthorization_request_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "preauthorization_request_outcomes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "preauthorization_request_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "preauthorization_request_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "preauthorization_threshold" (
	"preauthorization_threshold_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"county_id" uuid,
	"amount" numeric(12, 2),
	"currency_code" text DEFAULT 'USD' NOT NULL,
	"effective_from" date NOT NULL,
	"recorded_by_user_account_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_service_rate" (
	"provider_service_rate_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"service_description" text NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	"rate_basis" text NOT NULL,
	"effective_from" date NOT NULL,
	"document_id" uuid,
	"recorded_by_user_account_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "professional_kinds" ADD COLUMN "threshold_applies" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_document_id_document_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("document_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_invoice_id_invoice_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_preauthorization_id_preauthorization_preauthorization_id_fk" FOREIGN KEY ("preauthorization_id") REFERENCES "public"."preauthorization"("preauthorization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_preauthorization_request_id_preauthorization_request_preauthorization_request_id_fk" FOREIGN KEY ("preauthorization_request_id") REFERENCES "public"."preauthorization_request"("preauthorization_request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_professional_id_professional_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("professional_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_purpose_id_document_purposes_id_fk" FOREIGN KEY ("purpose_id") REFERENCES "public"."document_purposes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_overrun_explanation" ADD CONSTRAINT "invoice_overrun_explanation_invoice_id_invoice_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_overrun_explanation" ADD CONSTRAINT "invoice_overrun_explanation_invoice_approval_chain_id_invoice_approval_chain_invoice_approval_chain_id_fk" FOREIGN KEY ("invoice_approval_chain_id") REFERENCES "public"."invoice_approval_chain"("invoice_approval_chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_overrun_explanation" ADD CONSTRAINT "invoice_overrun_explanation_professional_id_professional_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("professional_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_overrun_explanation" ADD CONSTRAINT "invoice_overrun_explanation_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_question" ADD CONSTRAINT "preauthorization_question_preauthorization_request_id_preauthorization_request_preauthorization_request_id_fk" FOREIGN KEY ("preauthorization_request_id") REFERENCES "public"."preauthorization_request"("preauthorization_request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_question" ADD CONSTRAINT "preauthorization_question_asked_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("asked_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_question" ADD CONSTRAINT "preauthorization_question_answered_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("answered_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD CONSTRAINT "preauthorization_request_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD CONSTRAINT "preauthorization_request_professional_id_professional_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("professional_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD CONSTRAINT "preauthorization_request_preauthorization_id_preauthorization_preauthorization_id_fk" FOREIGN KEY ("preauthorization_id") REFERENCES "public"."preauthorization"("preauthorization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD CONSTRAINT "preauthorization_request_professional_kind_id_professional_kinds_id_fk" FOREIGN KEY ("professional_kind_id") REFERENCES "public"."professional_kinds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD CONSTRAINT "preauthorization_request_status_id_preauthorization_request_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."preauthorization_request_statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD CONSTRAINT "preauthorization_request_requested_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("requested_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD CONSTRAINT "preauthorization_request_requested_for_person_id_person_person_id_fk" FOREIGN KEY ("requested_for_person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD CONSTRAINT "preauthorization_request_outcome_id_preauthorization_request_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."preauthorization_request_outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD CONSTRAINT "preauthorization_request_preauthorization_decision_id_preauthorization_decision_preauthorization_decision_id_fk" FOREIGN KEY ("preauthorization_decision_id") REFERENCES "public"."preauthorization_decision"("preauthorization_decision_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD CONSTRAINT "preauthorization_request_decided_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("decided_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_request" ADD CONSTRAINT "preauthorization_request_withdrawn_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("withdrawn_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_threshold" ADD CONSTRAINT "preauthorization_threshold_county_id_county_county_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."county"("county_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preauthorization_threshold" ADD CONSTRAINT "preauthorization_threshold_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_rate" ADD CONSTRAINT "provider_service_rate_professional_id_professional_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("professional_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_rate" ADD CONSTRAINT "provider_service_rate_document_id_document_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("document_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_rate" ADD CONSTRAINT "provider_service_rate_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_link_professional_idx" ON "document_link" USING btree ("professional_id");--> statement-breakpoint
CREATE INDEX "document_link_request_idx" ON "document_link" USING btree ("preauthorization_request_id");--> statement-breakpoint
CREATE INDEX "invoice_overrun_explanation_invoice_idx" ON "invoice_overrun_explanation" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "preauthorization_question_request_idx" ON "preauthorization_question" USING btree ("preauthorization_request_id");--> statement-breakpoint
CREATE INDEX "preauthorization_request_case_idx" ON "preauthorization_request" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "preauthorization_request_requested_by_idx" ON "preauthorization_request" USING btree ("requested_by_user_account_id");--> statement-breakpoint
CREATE INDEX "preauthorization_threshold_county_idx" ON "preauthorization_threshold" USING btree ("county_id","effective_from");--> statement-breakpoint
CREATE INDEX "provider_service_rate_professional_idx" ON "provider_service_rate" USING btree ("professional_id");