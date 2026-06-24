CREATE TABLE "snmp_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"vendor" text DEFAULT '' NOT NULL,
	"device_type" text DEFAULT 'generic' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"standard" boolean DEFAULT true NOT NULL,
	"oids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
