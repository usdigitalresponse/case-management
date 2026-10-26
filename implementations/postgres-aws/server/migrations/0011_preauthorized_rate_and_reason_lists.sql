ALTER TABLE "invoice_decision_reasons" ADD COLUMN "applies_to" text DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "preauthorization_decision" ADD COLUMN "approved_hourly_rate" numeric(12, 2);--> statement-breakpoint
-- Separate lists for approving in part and rejecting (model/rules.yaml decide_invoice_lines).
UPDATE "invoice_decision_reasons" SET "applies_to" = 'approved_in_part', "display_name" = 'Rate is higher than the pre-authorized rate' WHERE "code" = 'rate_above_configured';--> statement-breakpoint
UPDATE "invoice_decision_reasons" SET "applies_to" = 'approved_in_part' WHERE "code" IN ('not_billable', 'excessive_time');--> statement-breakpoint
UPDATE "invoice_decision_reasons" SET "applies_to" = 'rejected', "display_name" = 'Block billing. List the tasks separately.' WHERE "code" = 'block_billing';--> statement-breakpoint
UPDATE "invoice_decision_reasons" SET "display_name" = 'Another reason. See the note.' WHERE "code" = 'other';--> statement-breakpoint
INSERT INTO "invoice_decision_reasons" ("code", "display_name", "applies_to") VALUES
  ('not_provider_service', 'Not an investigator or expert service', 'rejected'),
  ('no_backup', 'No back-up attached: receipt, map, or breakdown', 'rejected')
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- Status names as reviewers use them.
UPDATE "invoice_statuses" SET "display_name" = 'Waiting for review' WHERE "code" = 'submitted';--> statement-breakpoint
UPDATE "invoice_statuses" SET "display_name" = 'Signed off' WHERE "code" = 'approved';
