CREATE TABLE "process_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"entity" text NOT NULL,
	"cpu_pct" real,
	"mem_mb" real,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "process_metrics_entity_ts_idx" ON "process_metrics" USING btree ("source_id","entity","ts");