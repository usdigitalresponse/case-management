DROP TABLE "magic_link_token" CASCADE;
--> statement-breakpoint
CREATE TABLE "sign_in_code" (
	"sign_in_code_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sign_in_code_email_idx" ON "sign_in_code" USING btree ("email");