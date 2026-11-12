-- Sign-in and delegation are read through the account's person; link accounts that only their profile pointed at.
UPDATE "user_account" ua SET "person_id" = pr.person_id
FROM "professional" pr
WHERE pr.user_account_id = ua.user_account_id AND ua.person_id IS NULL;
