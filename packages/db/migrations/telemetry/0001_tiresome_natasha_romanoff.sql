CREATE TABLE "unit_states" (
	"source_id" text NOT NULL,
	"entity" text NOT NULL,
	"status" text NOT NULL,
	"pid" integer,
	"critical" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_states_source_id_entity_pk" PRIMARY KEY("source_id","entity")
);
--> statement-breakpoint
DROP INDEX "uptime_buckets_entity_start_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_buckets_entity_start_idx" ON "uptime_buckets" USING btree ("source_id","entity","bucket_start");