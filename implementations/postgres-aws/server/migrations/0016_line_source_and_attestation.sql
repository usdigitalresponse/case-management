CREATE TABLE "invoice_attestation" (
	"invoice_attestation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_approval_chain_id" uuid NOT NULL,
	"attestor_person_id" uuid NOT NULL,
	"recorded_by_user_account_id" uuid NOT NULL,
	"attested_at" timestamp with time zone NOT NULL,
	"statement" text NOT NULL,
	"signature_document_id" uuid
);
--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "source_location" text;--> statement-breakpoint
ALTER TABLE "invoice_attestation" ADD CONSTRAINT "invoice_attestation_invoice_approval_chain_id_invoice_approval_chain_invoice_approval_chain_id_fk" FOREIGN KEY ("invoice_approval_chain_id") REFERENCES "public"."invoice_approval_chain"("invoice_approval_chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_attestation" ADD CONSTRAINT "invoice_attestation_attestor_person_id_person_person_id_fk" FOREIGN KEY ("attestor_person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_attestation" ADD CONSTRAINT "invoice_attestation_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_attestation" ADD CONSTRAINT "invoice_attestation_signature_document_id_document_document_id_fk" FOREIGN KEY ("signature_document_id") REFERENCES "public"."document"("document_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_attestation_chain_idx" ON "invoice_attestation" USING btree ("invoice_approval_chain_id");