CREATE TABLE "contact_rules" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"cooldown_days" integer NOT NULL,
	"daily_cap_per_sender" integer NOT NULL,
	"quiet_hours_start" integer NOT NULL,
	"quiet_hours_end" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contact_rules_cooldown" CHECK ("contact_rules"."cooldown_days" BETWEEN 0 AND 365),
	CONSTRAINT "contact_rules_cap" CHECK ("contact_rules"."daily_cap_per_sender" BETWEEN 1 AND 10000),
	CONSTRAINT "contact_rules_quiet_hours" CHECK ("contact_rules"."quiet_hours_start" BETWEEN 0 AND 23 AND "contact_rules"."quiet_hours_end" BETWEEN 0 AND 23)
);
--> statement-breakpoint
ALTER TABLE "contact_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "touches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"relationship_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"step_number" integer NOT NULL,
	"follow_up" integer NOT NULL,
	"channel" text NOT NULL,
	"sender_id" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"draft" text DEFAULT '' NOT NULL,
	"draft_hash" text,
	"approved_hash" text,
	"approved_by" text,
	"sent_by" text,
	"sent_at" timestamp with time zone,
	"external_message_id" text,
	"sent_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skip_reason" text,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "touches_organization_id_product_id_id_unique" UNIQUE("organization_id","product_id","id"),
	CONSTRAINT "touch_follow_up" CHECK ("touches"."follow_up" BETWEEN 0 AND 3),
	CONSTRAINT "touch_sent_report" CHECK (("touches"."status" = 'sent') = ("touches"."sent_at" IS NOT NULL AND "touches"."sent_by" IS NOT NULL)),
	CONSTRAINT "touch_approval" CHECK ("touches"."status" <> 'approved' OR ("touches"."approved_hash" IS NOT NULL AND "touches"."approved_hash" = "touches"."draft_hash"))
);
--> statement-breakpoint
ALTER TABLE "touches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "pause_reason" text;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "enrolled_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "do_not_contact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "stage_id" uuid;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "stage_pipeline" text DEFAULT 'outreach' NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "next_step" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "next_step_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "last_outbound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "last_inbound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "touch_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "pipeline" text DEFAULT 'deal' NOT NULL;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
UPDATE "enrollments" SET "status" = 'paused', "pause_reason" = 'reply' WHERE "status" = 'paused_reply';--> statement-breakpoint
UPDATE "enrollments" SET "status" = 'paused', "pause_reason" = 'archived' WHERE "status" = 'paused_archived';--> statement-breakpoint
UPDATE "enrollments" AS "later" SET "status" = 'stopped', "pause_reason" = NULL
WHERE "later"."status" IN ('running', 'paused') AND EXISTS (
  SELECT 1 FROM "enrollments" AS "earlier"
  WHERE "earlier"."organization_id" = "later"."organization_id"
    AND "earlier"."relationship_id" = "later"."relationship_id"
    AND "earlier"."sequence_id" = "later"."sequence_id"
    AND "earlier"."status" IN ('running', 'paused')
    AND "earlier"."id" < "later"."id"
);--> statement-breakpoint
INSERT INTO "stages" ("organization_id", "product_id", "name", "position", "pipeline", "category")
SELECT "products"."organization_id", "products"."id", "outreach"."name", "outreach"."position", 'outreach', "outreach"."category"
FROM "products"
CROSS JOIN (VALUES
  ('New', 0, 'open'),
  ('Researching', 1, 'open'),
  ('Contacted', 2, 'open'),
  ('Follow-up', 3, 'open'),
  ('Replied', 4, 'open'),
  ('Meeting', 5, 'open'),
  ('Won', 6, 'won'),
  ('Lost', 7, 'lost'),
  ('Not now', 8, 'hold')
) AS "outreach" ("name", "position", "category");--> statement-breakpoint
UPDATE "relationships" SET "stage_id" = "stages"."id"
FROM "stages"
WHERE "stages"."organization_id" = "relationships"."organization_id"
  AND "stages"."product_id" = "relationships"."product_id"
  AND "stages"."pipeline" = 'outreach'
  AND "stages"."position" = 0;--> statement-breakpoint
UPDATE "relationships" SET
  "last_inbound_at" = (
    SELECT max("messages"."occurred_at") FROM "messages"
    INNER JOIN "conversations" ON "conversations"."id" = "messages"."conversation_id"
    WHERE "conversations"."relationship_id" = "relationships"."id" AND "messages"."direction" = 'inbound'
  ),
  "last_outbound_at" = (
    SELECT max("messages"."occurred_at") FROM "messages"
    INNER JOIN "conversations" ON "conversations"."id" = "messages"."conversation_id"
    WHERE "conversations"."relationship_id" = "relationships"."id" AND "messages"."direction" = 'outbound'
  );--> statement-breakpoint
UPDATE "sequences" SET "steps" = coalesce((
  SELECT jsonb_agg(
    "step" || jsonb_build_object(
      'template', coalesce("step"->>'template', ''),
      'followUp', least(greatest("position"::int - 1, 0), 3)
    ) ORDER BY "position"
  )
  FROM jsonb_array_elements("sequences"."steps") WITH ORDINALITY AS "existing" ("step", "position")
), '[]'::jsonb);--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_organization_id_product_id_relationship_id_id_unique" UNIQUE("organization_id","product_id","relationship_id","id");--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_organization_id_product_id_id_pipeline_unique" UNIQUE("organization_id","product_id","id","pipeline");--> statement-breakpoint
ALTER TABLE "contact_rules" ADD CONSTRAINT "contact_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_organization_id_product_id_relationship_id_relationships_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","relationship_id") REFERENCES "public"."relationships"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_organization_id_product_id_relationship_id_enrollment_id_enrollments_organization_id_product_id_relationship_id_id_fk" FOREIGN KEY ("organization_id","product_id","relationship_id","enrollment_id") REFERENCES "public"."enrollments"("organization_id","product_id","relationship_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_organization_id_sender_id_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","sender_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_organization_id_approved_by_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","approved_by") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_organization_id_sent_by_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","sent_by") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "touches_enrollment_step" ON "touches" USING btree ("organization_id","relationship_id","enrollment_id","step_number");--> statement-breakpoint
CREATE UNIQUE INDEX "touches_external_message" ON "touches" USING btree ("organization_id","channel","external_message_id") WHERE "touches"."external_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "touches_organization_id_product_id_status_due_at_index" ON "touches" USING btree ("organization_id","product_id","status","due_at");--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_organization_id_product_id_stage_id_stage_pipeline_stages_organization_id_product_id_id_pipeline_fk" FOREIGN KEY ("organization_id","product_id","stage_id","stage_pipeline") REFERENCES "public"."stages"("organization_id","product_id","id","pipeline") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_active_relationship_sequence" ON "enrollments" USING btree ("organization_id","relationship_id","sequence_id") WHERE "enrollments"."status" IN ('running', 'paused');--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollment_pause_reason" CHECK (("enrollments"."status" = 'paused') = ("enrollments"."pause_reason" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationship_stage_outreach" CHECK ("relationships"."stage_pipeline" = 'outreach');--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationship_touch_count" CHECK ("relationships"."touch_count" >= 0);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "contact_rules" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "touches" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);