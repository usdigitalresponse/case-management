-- Every question is about a line; any asked about the whole invoice goes on its first.
UPDATE "invoice_review_question" q SET "invoice_line_id" = (
  SELECT l."invoice_line_id" FROM "invoice_line" l
  WHERE l."invoice_id" = q."invoice_id"
  ORDER BY l."position", l."invoice_line_id" LIMIT 1
) WHERE q."invoice_line_id" IS NULL;--> statement-breakpoint
ALTER TABLE "invoice_review_question" ALTER COLUMN "invoice_line_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_review_question" DROP COLUMN "holds_review";
