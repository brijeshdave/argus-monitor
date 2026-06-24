CREATE TABLE "folder_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"storage_id" text NOT NULL,
	"folder" text NOT NULL,
	"size_bytes" bigint,
	"file_count" bigint,
	"folder_count" bigint,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "folder_metrics_folder_ts_idx" ON "folder_metrics" USING btree ("storage_id","folder","ts");