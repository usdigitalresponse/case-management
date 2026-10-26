CREATE TABLE "case_invoice_reviewer" (
	"case_invoice_reviewer_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"reviewer_user_account_id" uuid NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	"set_by_user_account_id" uuid NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoice_decision_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "invoice_decision_reasons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "invoice_line_working_decision" (
	"invoice_line_working_decision_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_approval_chain_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"outcome_id" uuid NOT NULL,
	"approved_amount" numeric(12, 2),
	"approved_quantity" numeric(10, 2),
	"approved_rate" numeric(12, 3),
	"reason_code_id" uuid,
	"note" text,
	"decided_by_user_account_id" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_review_assignment" (
	"invoice_review_assignment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"step_type_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"assigned_user_account_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"assigned_by_user_account_id" uuid,
	"ended_at" timestamp with time zone,
	"ended_by_user_account_id" uuid
);
--> statement-breakpoint
CREATE TABLE "invoice_review_setting" (
	"invoice_review_setting_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"setting_code" text NOT NULL,
	"parameters" jsonb,
	"recorded_by_user_account_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_approval_decision" ADD COLUMN "reason_code_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_approval_decision" ADD COLUMN "internal_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_approval_decision" ADD COLUMN "approved_quantity" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "invoice_approval_decision" ADD COLUMN "approved_rate" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "configured_rate" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "case_invoice_reviewer" ADD CONSTRAINT "case_invoice_reviewer_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_invoice_reviewer" ADD CONSTRAINT "case_invoice_reviewer_reviewer_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("reviewer_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_invoice_reviewer" ADD CONSTRAINT "case_invoice_reviewer_set_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("set_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_working_decision" ADD CONSTRAINT "invoice_line_working_decision_invoice_approval_chain_id_invoice_approval_chain_invoice_approval_chain_id_fk" FOREIGN KEY ("invoice_approval_chain_id") REFERENCES "public"."invoice_approval_chain"("invoice_approval_chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_working_decision" ADD CONSTRAINT "invoice_line_working_decision_invoice_line_id_invoice_line_invoice_line_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_line"("invoice_line_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_working_decision" ADD CONSTRAINT "invoice_line_working_decision_outcome_id_invoice_approval_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."invoice_approval_outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_working_decision" ADD CONSTRAINT "invoice_line_working_decision_reason_code_id_invoice_decision_reasons_id_fk" FOREIGN KEY ("reason_code_id") REFERENCES "public"."invoice_decision_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_working_decision" ADD CONSTRAINT "invoice_line_working_decision_decided_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("decided_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_assignment" ADD CONSTRAINT "invoice_review_assignment_invoice_id_invoice_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_assignment" ADD CONSTRAINT "invoice_review_assignment_step_type_id_invoice_approval_step_types_id_fk" FOREIGN KEY ("step_type_id") REFERENCES "public"."invoice_approval_step_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_assignment" ADD CONSTRAINT "invoice_review_assignment_assigned_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("assigned_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_assignment" ADD CONSTRAINT "invoice_review_assignment_assigned_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("assigned_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_assignment" ADD CONSTRAINT "invoice_review_assignment_ended_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("ended_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_setting" ADD CONSTRAINT "invoice_review_setting_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_invoice_reviewer_open_uidx" ON "case_invoice_reviewer" USING btree ("case_id") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_line_working_decision_line_uidx" ON "invoice_line_working_decision" USING btree ("invoice_approval_chain_id","invoice_line_id");--> statement-breakpoint
CREATE INDEX "invoice_review_assignment_invoice_idx" ON "invoice_review_assignment" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_review_assignment_user_idx" ON "invoice_review_assignment" USING btree ("assigned_user_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_review_assignment_open_uidx" ON "invoice_review_assignment" USING btree ("invoice_id","step_type_id","position") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE INDEX "invoice_review_setting_code_idx" ON "invoice_review_setting" USING btree ("setting_code","recorded_at");--> statement-breakpoint
ALTER TABLE "invoice_approval_decision" ADD CONSTRAINT "invoice_approval_decision_reason_code_id_invoice_decision_reasons_id_fk" FOREIGN KEY ("reason_code_id") REFERENCES "public"."invoice_decision_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_approval_decision_invoice_uidx" ON "invoice_approval_decision" USING btree ("invoice_approval_chain_id","sequence_number") WHERE invoice_line_id IS NULL;--> statement-breakpoint
-- Hand-written: invoices part-way through the old one-decision-at-a-time
-- review carry on as a round in progress. Their recorded decisions are kept;
-- copies become working decisions and the next finished round is recorded at
-- a later sequence number. ensureReferenceData seeds the same rows.
INSERT INTO "invoice_statuses" ("code", "display_name") VALUES ('under_review', 'Being reviewed'), ('awaiting_sign_off', 'Waiting for sign-off') ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "invoice_decision_reasons" ("code", "display_name") VALUES ('other', 'Another reason. Explain in the note.') ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "invoice_line_working_decision" ("invoice_approval_chain_id", "invoice_line_id", "outcome_id", "approved_amount", "reason_code_id", "note", "decided_by_user_account_id", "decided_at")
SELECT d."invoice_approval_chain_id", d."invoice_line_id", d."outcome_id", d."approved_amount",
  CASE WHEN o."code" = 'rejected' THEN (SELECT "id" FROM "invoice_decision_reasons" WHERE "code" = 'other') END,
  d."reason", d."decided_by_user_account_id", d."decided_at"
FROM "invoice_approval_decision" d
JOIN "invoice_approval_chain" c ON c."invoice_approval_chain_id" = d."invoice_approval_chain_id" AND c."superseded_at" IS NULL
JOIN "invoice" i ON i."invoice_id" = c."invoice_id"
JOIN "invoice_statuses" s ON s."id" = i."status_id" AND s."code" = 'submitted'
JOIN "invoice_approval_outcomes" o ON o."id" = d."outcome_id"
WHERE d."invoice_line_id" IS NOT NULL;--> statement-breakpoint
UPDATE "invoice" SET "status_id" = (SELECT "id" FROM "invoice_statuses" WHERE "code" = 'under_review')
WHERE EXISTS (
  SELECT 1 FROM "invoice_line_working_decision" w
  JOIN "invoice_approval_chain" c ON c."invoice_approval_chain_id" = w."invoice_approval_chain_id"
  WHERE c."invoice_id" = "invoice"."invoice_id"
);
