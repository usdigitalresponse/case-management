-- Design K's plain words for two starting reasons; a name an administrator changed is kept.
UPDATE "invoice_decision_reasons" SET "display_name" = 'Several tasks in one entry. List them separately.' WHERE "code" = 'block_billing' AND "display_name" = 'Block billing. List the tasks separately.';--> statement-breakpoint
UPDATE "invoice_decision_reasons" SET "display_name" = 'No supporting document attached: receipt, map or breakdown' WHERE "code" = 'no_backup' AND "display_name" = 'No back-up attached: receipt, map, or breakdown';
