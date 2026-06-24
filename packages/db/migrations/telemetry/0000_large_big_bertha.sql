CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text,
	"actor_role" text,
	"action" text NOT NULL,
	"category" text NOT NULL,
	"target" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_events" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"service" text NOT NULL,
	"remote_ip" text NOT NULL,
	"remote_port" integer,
	"type" text NOT NULL,
	"duration_sec" integer,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "db_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"monitor_id" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"cpu_pct" real,
	"mem_pct" real,
	"mem_used_mb" integer,
	"extra" jsonb,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"level" text NOT NULL,
	"source_id" text,
	"message" text NOT NULL,
	"context" jsonb,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"severity" text NOT NULL,
	"source_id" text,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"plain_language" text,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_events" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"entity" text NOT NULL,
	"type" text NOT NULL,
	"old_status" text,
	"new_status" text,
	"old_pid" integer,
	"new_pid" integer,
	"detail" jsonb,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"storage_id" text NOT NULL,
	"share" text,
	"used_pct" real,
	"used_bytes" bigint,
	"total_bytes" bigint,
	"metrics" jsonb,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"entity" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"up_sec" integer DEFAULT 0 NOT NULL,
	"total_sec" integer DEFAULT 0 NOT NULL,
	"status_summary" jsonb
);
--> statement-breakpoint
CREATE INDEX "audit_log_category_ts_idx" ON "audit_log" USING btree ("category","ts");--> statement-breakpoint
CREATE INDEX "client_events_service_ts_idx" ON "client_events" USING btree ("source_id","service","ts");--> statement-breakpoint
CREATE INDEX "db_metrics_monitor_ts_idx" ON "db_metrics" USING btree ("monitor_id","ts");--> statement-breakpoint
CREATE INDEX "host_metrics_agent_ts_idx" ON "host_metrics" USING btree ("agent_id","ts");--> statement-breakpoint
CREATE INDEX "logs_category_ts_idx" ON "logs" USING btree ("category","ts");--> statement-breakpoint
CREATE INDEX "notifications_severity_ts_idx" ON "notifications" USING btree ("severity","ts");--> statement-breakpoint
CREATE INDEX "status_events_entity_ts_idx" ON "status_events" USING btree ("source_id","entity","ts");--> statement-breakpoint
CREATE INDEX "storage_metrics_storage_ts_idx" ON "storage_metrics" USING btree ("storage_id","ts");--> statement-breakpoint
CREATE INDEX "uptime_buckets_entity_start_idx" ON "uptime_buckets" USING btree ("source_id","entity","bucket_start");