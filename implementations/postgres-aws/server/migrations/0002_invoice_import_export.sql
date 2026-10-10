CREATE TABLE "document" (
	"document_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_reference" text NOT NULL,
	"display_name" text NOT NULL,
	"media_type" text NOT NULL,
	"content_hash" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"recorded_by_user_account_id" uuid NOT NULL,
	"supersedes_document_id" uuid,
	"content_deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoice_event" (
	"invoice_event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_approval_chain_id" uuid,
	"sequence_number" integer NOT NULL,
	"event_type_id" uuid NOT NULL,
	"resulting_status_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_user_account_id" uuid,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "invoice_event_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "invoice_event_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "invoice_import" (
	"invoice_import_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"uploaded_by_user_account_id" uuid NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	"case_id" uuid,
	"source_format_id" uuid NOT NULL,
	"status_id" uuid NOT NULL,
	"extraction_method" text,
	"extracted_at" timestamp with time zone,
	"extraction_result" jsonb,
	"invoice_id" uuid,
	"resolved_by_user_account_id" uuid,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoice_import_formats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "invoice_import_formats_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "invoice_import_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "invoice_import_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "invoice_approval_chain" ADD COLUMN "submission_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "service_date" date;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "quantity" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "unit_rate" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "timekeeper_label" text;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "timekeeper_professional_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "task_code" text;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "activity_code" text;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "expense_code" text;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "source_invoice_import_id" uuid;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_supersedes_document_id_document_document_id_fk" FOREIGN KEY ("supersedes_document_id") REFERENCES "public"."document"("document_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_event" ADD CONSTRAINT "invoice_event_invoice_id_invoice_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_event" ADD CONSTRAINT "invoice_event_invoice_approval_chain_id_invoice_approval_chain_invoice_approval_chain_id_fk" FOREIGN KEY ("invoice_approval_chain_id") REFERENCES "public"."invoice_approval_chain"("invoice_approval_chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_event" ADD CONSTRAINT "invoice_event_event_type_id_invoice_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."invoice_event_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_event" ADD CONSTRAINT "invoice_event_resulting_status_id_invoice_statuses_id_fk" FOREIGN KEY ("resulting_status_id") REFERENCES "public"."invoice_statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_event" ADD CONSTRAINT "invoice_event_actor_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("actor_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_import" ADD CONSTRAINT "invoice_import_document_id_document_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("document_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_import" ADD CONSTRAINT "invoice_import_uploaded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("uploaded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_import" ADD CONSTRAINT "invoice_import_case_id_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_import" ADD CONSTRAINT "invoice_import_source_format_id_invoice_import_formats_id_fk" FOREIGN KEY ("source_format_id") REFERENCES "public"."invoice_import_formats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_import" ADD CONSTRAINT "invoice_import_status_id_invoice_import_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."invoice_import_statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_import" ADD CONSTRAINT "invoice_import_invoice_id_invoice_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_import" ADD CONSTRAINT "invoice_import_resolved_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("resolved_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_content_hash_idx" ON "document" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_event_invoice_sequence_unique" ON "invoice_event" USING btree ("invoice_id","sequence_number");--> statement-breakpoint
CREATE INDEX "invoice_import_uploaded_by_idx" ON "invoice_import" USING btree ("uploaded_by_user_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_import_invoice_id_uidx" ON "invoice_import" USING btree ("invoice_id");--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_timekeeper_professional_id_professional_professional_id_fk" FOREIGN KEY ("timekeeper_professional_id") REFERENCES "public"."professional"("professional_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_source_invoice_import_id_invoice_import_invoice_import_id_fk" FOREIGN KEY ("source_invoice_import_id") REFERENCES "public"."invoice_import"("invoice_import_id") ON DELETE no action ON UPDATE no action;