CREATE TABLE "wall_device_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"layout_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wall_devices" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "wall_device_groups" ADD CONSTRAINT "wall_device_groups_layout_id_wall_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."wall_layouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wall_devices" ADD CONSTRAINT "wall_devices_group_id_wall_device_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."wall_device_groups"("id") ON DELETE no action ON UPDATE no action;