ALTER TABLE "invoice" ALTER COLUMN "case_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line" ALTER COLUMN "case_id" DROP NOT NULL;