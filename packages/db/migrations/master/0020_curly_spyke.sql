ALTER TABLE "public_config" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "public_config" ADD COLUMN "show_history" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "public_config" ADD COLUMN "history_days" integer DEFAULT 90 NOT NULL;