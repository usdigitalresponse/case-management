CREATE TABLE "case_assignment" (
	"case_assignment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"assignment_role_id" uuid NOT NULL,
	"affiliation_id" uuid,
	"assigned_by_user_account_id" uuid NOT NULL,
	"ended_by_user_account_id" uuid,
	"end_reason" text
);
--> statement-breakpoint
CREATE TABLE "professional" (
	"professional_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_account_id" uuid,
	"person_id" uuid NOT NULL,
	"display_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"office_id" uuid
);
--> statement-breakpoint
ALTER TABLE "case_assignment" ADD CONSTRAINT "case_assignment_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignment" ADD CONSTRAINT "case_assignment_professional_id_professional_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("professional_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignment" ADD CONSTRAINT "case_assignment_assignment_role_id_role_role_id_fk" FOREIGN KEY ("assignment_role_id") REFERENCES "public"."role"("role_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignment" ADD CONSTRAINT "case_assignment_affiliation_id_person_affiliation_person_affiliation_id_fk" FOREIGN KEY ("affiliation_id") REFERENCES "public"."person_affiliation"("person_affiliation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignment" ADD CONSTRAINT "case_assignment_assigned_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("assigned_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignment" ADD CONSTRAINT "case_assignment_ended_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("ended_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional" ADD CONSTRAINT "professional_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional" ADD CONSTRAINT "professional_person_id_person_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional" ADD CONSTRAINT "professional_office_id_office_office_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."office"("office_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_assignment_professional_id_idx" ON "case_assignment" USING btree ("professional_id");--> statement-breakpoint
CREATE INDEX "case_assignment_case_id_idx" ON "case_assignment" USING btree ("case_id");