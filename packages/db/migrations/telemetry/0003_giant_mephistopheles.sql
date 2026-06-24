CREATE TABLE "host_inventory" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"services" jsonb,
	"processes" jsonb,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
