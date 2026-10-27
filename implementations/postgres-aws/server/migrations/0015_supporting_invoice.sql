CREATE TABLE "supporting_invoice" (
	"supporting_invoice_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"issued_on" date,
	"period_start" date,
	"period_end" date,
	"document_id" uuid
);
--> statement-breakpoint
ALTER TABLE "supporting_invoice" ADD CONSTRAINT "supporting_invoice_invoice_id_invoice_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_invoice" ADD CONSTRAINT "supporting_invoice_document_id_document_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("document_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supporting_invoice_invoice_id_idx" ON "supporting_invoice" USING btree ("invoice_id");