ALTER TABLE "person" ADD COLUMN "external_sign_in_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The old allowlist was an environment setting this can't read. Turn sign-in on for everyone with an
-- active external (non-staff) account, which is everyone who has signed in or was seeded; administrators
-- review the list in Settings after deploying. Allowlisted people who never signed in must be turned on there.
WITH external_account AS (
	SELECT ua.user_account_id, ua.person_id
	FROM "user_account" ua
	LEFT JOIN "role" r ON r.role_id = ua.system_role_id
	WHERE ua.active
		AND (r.role_id IS NULL OR r.display_name NOT IN ('Staff', 'Administrator', 'Intake Staff', 'Billing Reviewer', 'Sign-off Approver'))
)
UPDATE "person" SET "external_sign_in_enabled" = true
WHERE "merged_into_person_id" IS NULL
	AND "person_id" IN (
		SELECT person_id FROM external_account WHERE person_id IS NOT NULL
		UNION
		SELECT pr.person_id FROM "professional" pr JOIN external_account ea ON ea.user_account_id = pr.user_account_id
	);
