CREATE TABLE "client_meta" (
	"ip" text PRIMARY KEY NOT NULL,
	"hostname" text,
	"description" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
