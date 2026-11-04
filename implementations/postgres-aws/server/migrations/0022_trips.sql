CREATE TABLE "travel_time_rate" (
	"travel_time_rate_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"basis" text NOT NULL,
	"percent" numeric(5, 2),
	"hourly_rate" numeric(12, 2),
	"effective_from" date NOT NULL,
	"recorded_by_user_account_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip" (
	"trip_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"trip_date" date,
	"trip_origin" text,
	"trip_destination" text,
	"round_trip" boolean DEFAULT false NOT NULL,
	"route_distance" numeric(10, 1),
	"route_checked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "trip_id" uuid;--> statement-breakpoint
ALTER TABLE "travel_time_rate" ADD CONSTRAINT "travel_time_rate_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_invoice_id_invoice_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "travel_time_rate_effective_idx" ON "travel_time_rate" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "trip_invoice_id_idx" ON "trip" USING btree ("invoice_id");--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_trip_id_trip_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("trip_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Each existing mileage line becomes a trip of its own, keyed by the line's id.
INSERT INTO "trip" ("trip_id", "invoice_id", "trip_date", "trip_origin", "trip_destination", "round_trip", "route_distance", "route_checked_at")
SELECT l."invoice_line_id", l."invoice_id", l."service_date", l."trip_origin", l."trip_destination", l."round_trip", l."route_distance", l."route_checked_at"
FROM "invoice_line" l JOIN "expense_types" e ON e."id" = l."expense_type_id"
WHERE e."code" = 'mileage';--> statement-breakpoint
UPDATE "invoice_line" l SET "trip_id" = l."invoice_line_id"
FROM "expense_types" e
WHERE e."id" = l."expense_type_id" AND e."code" = 'mileage';
