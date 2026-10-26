CREATE TABLE "invoice_receipt_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "invoice_receipt_channels_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "received_via_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "received_on" date;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_received_via_id_invoice_receipt_channels_id_fk" FOREIGN KEY ("received_via_id") REFERENCES "public"."invoice_receipt_channels"("id") ON DELETE no action ON UPDATE no action;