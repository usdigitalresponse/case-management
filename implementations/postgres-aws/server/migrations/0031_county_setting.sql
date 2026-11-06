ALTER TABLE "county" ADD COLUMN "is_county" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "county_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_county_id_county_county_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."county"("county_id") ON DELETE no action ON UPDATE no action;