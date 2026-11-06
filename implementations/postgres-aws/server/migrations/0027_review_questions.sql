CREATE TABLE "invoice_review_question" (
	"invoice_review_question_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_approval_chain_id" uuid NOT NULL,
	"invoice_line_id" uuid,
	"question" text NOT NULL,
	"holds_review" boolean NOT NULL,
	"asked_by_user_account_id" uuid NOT NULL,
	"asked_at" timestamp with time zone NOT NULL,
	"answer" text,
	"answered_by_user_account_id" uuid,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invoice_review_question" ADD CONSTRAINT "invoice_review_question_invoice_id_invoice_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_question" ADD CONSTRAINT "invoice_review_question_invoice_approval_chain_id_invoice_approval_chain_invoice_approval_chain_id_fk" FOREIGN KEY ("invoice_approval_chain_id") REFERENCES "public"."invoice_approval_chain"("invoice_approval_chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_question" ADD CONSTRAINT "invoice_review_question_invoice_line_id_invoice_line_invoice_line_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_line"("invoice_line_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_question" ADD CONSTRAINT "invoice_review_question_asked_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("asked_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_question" ADD CONSTRAINT "invoice_review_question_answered_by_user_account_id_user_account_user_account_id_fk" FOREIGN KEY ("answered_by_user_account_id") REFERENCES "public"."user_account"("user_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_review_question_invoice_idx" ON "invoice_review_question" USING btree ("invoice_id");