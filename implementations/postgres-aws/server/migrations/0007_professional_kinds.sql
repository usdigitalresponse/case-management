CREATE TABLE "professional_kind_rate" (
	"professional_kind_rate_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_kind_id" uuid NOT NULL,
	"hourly_rate" numeric(12, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"recorded_by_user_account_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professional_kinds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "professional_kinds_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "professional" ADD COLUMN "professional_kind_id" uuid;--> statement-breakpoint
ALTER TABLE "professional_kind_rate" ADD CONSTRAINT "professional_kind_rate_professional_kind_id_professional_kinds_id_fk" FOREIGN KEY ("professional_kind_id") REFERENCES "public"."professional_kinds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_kind_rate" ADD CONSTRAINT "professional_kind_rate_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "professional_kind_rate_kind_idx" ON "professional_kind_rate" USING btree ("professional_kind_id","effective_from");--> statement-breakpoint
ALTER TABLE "professional" ADD CONSTRAINT "professional_professional_kind_id_professional_kinds_id_fk" FOREIGN KEY ("professional_kind_id") REFERENCES "public"."professional_kinds"("id") ON DELETE no action ON UPDATE no action;