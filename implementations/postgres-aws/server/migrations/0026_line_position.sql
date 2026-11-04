-- Existing lines keep the order they were shown in.
ALTER TABLE "invoice_line" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "invoice_line" SET "position" = ordered."position" FROM (
  SELECT l."invoice_line_id", row_number() OVER (
    PARTITION BY l."invoice_id" ORDER BY l."service_date", t."activity_on", l."invoice_line_id"
  ) - 1 AS "position"
  FROM "invoice_line" l LEFT JOIN "time_entry" t ON t."time_entry_id" = l."source_time_entry_id"
) ordered WHERE ordered."invoice_line_id" = "invoice_line"."invoice_line_id";--> statement-breakpoint
ALTER TABLE "invoice_line" DROP COLUMN "service_date_inferred";
