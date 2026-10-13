CREATE TABLE "expense_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "expense_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "mileage_rate" (
	"mileage_rate_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_per_mile" numeric(8, 3) NOT NULL,
	"effective_from" date NOT NULL,
	"recorded_by_user_account_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_check" (
	"route_check_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_key" text NOT NULL,
	"outcome" text NOT NULL,
	"distance_miles" numeric(10, 1),
	"api_calls" integer NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_line" ALTER COLUMN "billed_rate" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "expense_type_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "trip_origin" text;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "trip_destination" text;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "round_trip" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "route_distance" numeric(10, 1);--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "route_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mileage_rate" ADD CONSTRAINT "mileage_rate_recorded_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("recorded_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mileage_rate_effective_idx" ON "mileage_rate" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "route_check_pair_idx" ON "route_check" USING btree ("pair_key");--> statement-breakpoint
CREATE INDEX "route_check_checked_at_idx" ON "route_check" USING btree ("checked_at");--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_expense_type_id_expense_types_id_fk" FOREIGN KEY ("expense_type_id") REFERENCES "public"."expense_types"("id") ON DELETE no action ON UPDATE no action;