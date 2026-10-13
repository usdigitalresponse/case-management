CREATE TABLE "billing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "billing_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "billing_rule_setting" (
	"billing_rule_setting_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_code" text NOT NULL,
	"enforcement" text NOT NULL,
	"parameters" jsonb,
	"recorded_by_user_account_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_rule_setting" ADD CONSTRAINT "billing_rule_setting_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_rule_setting_rule_idx" ON "billing_rule_setting" USING btree ("rule_code","recorded_at");