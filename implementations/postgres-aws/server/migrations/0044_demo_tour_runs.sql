CREATE TABLE "demo_tour_record" (
	"demo_tour_run_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"record_id" uuid NOT NULL,
	CONSTRAINT "demo_tour_record_demo_tour_run_id_table_name_record_id_pk" PRIMARY KEY("demo_tour_run_id","table_name","record_id")
);
--> statement-breakpoint
CREATE TABLE "demo_tour_run" (
	"demo_tour_run_id" uuid PRIMARY KEY NOT NULL,
	"mission" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kept_reason" text
);
--> statement-breakpoint
ALTER TABLE "demo_tour_record" ADD CONSTRAINT "demo_tour_record_demo_tour_run_id_demo_tour_run_demo_tour_run_id_fk" FOREIGN KEY ("demo_tour_run_id") REFERENCES "public"."demo_tour_run"("demo_tour_run_id") ON DELETE cascade ON UPDATE no action;