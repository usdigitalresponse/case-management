UPDATE "role" SET "display_name" = 'Staff'
WHERE "display_name" = 'Intake Staff' AND "role_context" = 'user_account'
  AND NOT EXISTS (SELECT 1 FROM "role" AS "existing" WHERE "existing"."display_name" = 'Staff' AND "existing"."role_context" = 'user_account');--> statement-breakpoint
UPDATE "role" SET "active" = false WHERE "display_name" IN ('Intake Staff', 'Billing Reviewer', 'Sign-off Approver') AND "role_context" = 'user_account';
