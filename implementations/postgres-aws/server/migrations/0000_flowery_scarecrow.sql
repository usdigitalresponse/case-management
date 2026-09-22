CREATE TABLE "case_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "case_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "case_identifier" (
	"case_identifier_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"identifier_type_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"value" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_identifier_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "case_identifier_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "case_lifecycle_event" (
	"case_lifecycle_event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"event_type_id" uuid NOT NULL,
	"resulting_status_id" uuid NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"actor_user_account_id" uuid NOT NULL,
	"reason_id" uuid,
	"reason_detail" text,
	"reference_number" text,
	"corrects_event_id" uuid
);
--> statement-breakpoint
CREATE TABLE "case_lifecycle_event_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "case_lifecycle_event_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "case_lifecycle_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "case_lifecycle_reasons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "case_participant" (
	"case_participant_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"participant_role_id" uuid NOT NULL,
	"affiliation_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "case_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "case_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "case" (
	"case_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"county_id" uuid,
	"external_reference" text,
	"case_category_id" uuid,
	"status_id" uuid NOT NULL,
	"opened_on" date,
	"closed_on" date,
	"organization_id" uuid,
	"office_id" uuid,
	"jurisdiction_id" uuid,
	"preferred_language_id" uuid
);
--> statement-breakpoint
CREATE TABLE "county" (
	"county_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_request" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jurisdictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "jurisdictions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "languages_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "office" (
	"office_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"organization_id" uuid
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"organization_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person" (
	"person_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"given_name" text,
	"middle_name" text,
	"family_name" text,
	"display_name" text NOT NULL,
	"date_of_birth" date,
	"email" text
);
--> statement-breakpoint
CREATE TABLE "person_affiliation" (
	"person_affiliation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"office_id" uuid,
	"affiliation_role_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "role" (
	"role_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"role_context" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_account" (
	"user_account_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"email" text NOT NULL,
	"person_id" uuid,
	"system_role_id" uuid,
	CONSTRAINT "user_account_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "case_identifier" ADD CONSTRAINT "case_identifier_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_identifier" ADD CONSTRAINT "case_identifier_identifier_type_id_case_identifier_types_id_fk" FOREIGN KEY ("identifier_type_id") REFERENCES "public"."case_identifier_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_lifecycle_event" ADD CONSTRAINT "case_lifecycle_event_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_lifecycle_event" ADD CONSTRAINT "case_lifecycle_event_event_type_id_case_lifecycle_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."case_lifecycle_event_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_lifecycle_event" ADD CONSTRAINT "case_lifecycle_event_resulting_status_id_case_statuses_id_fk" FOREIGN KEY ("resulting_status_id") REFERENCES "public"."case_statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_lifecycle_event" ADD CONSTRAINT "case_lifecycle_event_actor_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("actor_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_lifecycle_event" ADD CONSTRAINT "case_lifecycle_event_reason_id_case_lifecycle_reasons_id_fk" FOREIGN KEY ("reason_id") REFERENCES "public"."case_lifecycle_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_lifecycle_event" ADD CONSTRAINT "case_lifecycle_event_corrects_event_id_case_lifecycle_event_case_lifecycle_event_id_fk" FOREIGN KEY ("corrects_event_id") REFERENCES "public"."case_lifecycle_event"("case_lifecycle_event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_participant" ADD CONSTRAINT "case_participant_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_participant" ADD CONSTRAINT "case_participant_person_id_person_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_participant" ADD CONSTRAINT "case_participant_participant_role_id_role_role_id_fk" FOREIGN KEY ("participant_role_id") REFERENCES "public"."role"("role_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_participant" ADD CONSTRAINT "case_participant_affiliation_id_person_affiliation_person_affiliation_id_fk" FOREIGN KEY ("affiliation_id") REFERENCES "public"."person_affiliation"("person_affiliation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "case_client_id_person_person_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "case_county_id_county_county_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."county"("county_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "case_case_category_id_case_categories_id_fk" FOREIGN KEY ("case_category_id") REFERENCES "public"."case_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "case_status_id_case_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."case_statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "case_organization_id_organization_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "case_office_id_office_office_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."office"("office_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "case_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "case_preferred_language_id_languages_id_fk" FOREIGN KEY ("preferred_language_id") REFERENCES "public"."languages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_request" ADD CONSTRAINT "intake_request_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office" ADD CONSTRAINT "office_organization_id_organization_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_affiliation" ADD CONSTRAINT "person_affiliation_person_id_person_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_affiliation" ADD CONSTRAINT "person_affiliation_organization_id_organization_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_affiliation" ADD CONSTRAINT "person_affiliation_office_id_office_office_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."office"("office_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_affiliation" ADD CONSTRAINT "person_affiliation_affiliation_role_id_role_role_id_fk" FOREIGN KEY ("affiliation_role_id") REFERENCES "public"."role"("role_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_person_id_person_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_system_role_id_role_role_id_fk" FOREIGN KEY ("system_role_id") REFERENCES "public"."role"("role_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_identifier_issuer_type_value_unique" ON "case_identifier" USING btree ("issuer","identifier_type_id","value");--> statement-breakpoint
CREATE UNIQUE INDEX "case_identifier_one_primary_per_case" ON "case_identifier" USING btree ("case_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "case_identifier_case_id_idx" ON "case_identifier" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_lifecycle_event_case_sequence_unique" ON "case_lifecycle_event" USING btree ("case_id","sequence_number");--> statement-breakpoint
CREATE UNIQUE INDEX "case_participant_open_unique" ON "case_participant" USING btree ("case_id","person_id","participant_role_id","affiliation_id") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE INDEX "case_participant_case_id_idx" ON "case_participant" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_county_id_idx" ON "case" USING btree ("county_id");--> statement-breakpoint
CREATE INDEX "case_status_id_idx" ON "case" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "case_category_id_idx" ON "case" USING btree ("case_category_id");