CREATE TABLE "mib_objects" (
	"oid" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"unit" text,
	"description" text,
	"mib" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
