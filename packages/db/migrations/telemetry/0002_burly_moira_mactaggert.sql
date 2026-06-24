CREATE TABLE "ping_samples" (
	"id" text PRIMARY KEY NOT NULL,
	"monitor_id" text NOT NULL,
	"source_id" text NOT NULL,
	"up" boolean NOT NULL,
	"latency_ms" real,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ping_samples_monitor_ts_idx" ON "ping_samples" USING btree ("monitor_id","ts");