CREATE TABLE "snmp_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"monitor_id" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "snmp_metrics_monitor_ts_idx" ON "snmp_metrics" USING btree ("monitor_id","ts");