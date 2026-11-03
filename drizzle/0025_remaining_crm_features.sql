CREATE TABLE "internal_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"relationship_id" uuid,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"time_zone" text NOT NULL,
	"recurrence" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_tasks_organization_id_product_id_id_unique" UNIQUE("organization_id","product_id","id")
);
--> statement-breakpoint
ALTER TABLE "internal_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "native_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"relationship_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"source_conversation_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"title" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"source_id" text NOT NULL,
	"source_hash" text NOT NULL,
	"scheduled_action_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "native_drafts_organization_id_product_id_id_unique" UNIQUE("organization_id","product_id","id"),
	CONSTRAINT "native_draft_source_hash" CHECK ("native_drafts"."source_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "native_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "yodu_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"external_subject_id" text NOT NULL,
	"relationship_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "yodu_bindings_source_id_external_subject_id_unique" UNIQUE("source_id","external_subject_id")
);
--> statement-breakpoint
ALTER TABLE "yodu_bindings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "yodu_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"external_subject_id" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"payload_hash" text NOT NULL,
	"source_version" integer NOT NULL,
	CONSTRAINT "yodu_events_source_id_provider_event_id_unique" UNIQUE("source_id","provider_event_id"),
	CONSTRAINT "yodu_event_kind" CHECK ("yodu_events"."kind" IN ('signup', 'onboarding', 'payment', 'activation')),
	CONSTRAINT "yodu_event_hash" CHECK ("yodu_events"."payload_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "yodu_event_source_version" CHECK ("yodu_events"."source_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "yodu_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "yodu_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"encrypted_secret" text NOT NULL,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "yodu_sources_organization_id_product_id_id_unique" UNIQUE("organization_id","product_id","id")
);
--> statement-breakpoint
ALTER TABLE "yodu_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "connection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "connection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "reason_source" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "provenance" text DEFAULT 'provider' NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_organization_id_product_id_products_organization_id_id_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_organization_id_product_id_relationship_id_relationships_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","relationship_id") REFERENCES "public"."relationships"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_organization_id_owner_id_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","owner_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_drafts" ADD CONSTRAINT "native_drafts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_drafts" ADD CONSTRAINT "native_drafts_organization_id_product_id_relationship_id_relationships_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","relationship_id") REFERENCES "public"."relationships"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_drafts" ADD CONSTRAINT "native_drafts_organization_id_owner_id_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","owner_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_drafts" ADD CONSTRAINT "native_drafts_organization_id_product_id_source_conversation_id_conversations_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","source_conversation_id") REFERENCES "public"."conversations"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_drafts" ADD CONSTRAINT "native_drafts_organization_id_product_id_scheduled_action_id_actions_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","scheduled_action_id") REFERENCES "public"."actions"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yodu_bindings" ADD CONSTRAINT "yodu_bindings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yodu_bindings" ADD CONSTRAINT "yodu_bindings_organization_id_product_id_source_id_yodu_sources_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","source_id") REFERENCES "public"."yodu_sources"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yodu_bindings" ADD CONSTRAINT "yodu_bindings_organization_id_product_id_relationship_id_relationships_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","relationship_id") REFERENCES "public"."relationships"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yodu_bindings" ADD CONSTRAINT "yodu_bindings_organization_id_created_by_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","created_by") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yodu_events" ADD CONSTRAINT "yodu_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yodu_events" ADD CONSTRAINT "yodu_events_organization_id_product_id_source_id_yodu_sources_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","source_id") REFERENCES "public"."yodu_sources"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yodu_sources" ADD CONSTRAINT "yodu_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yodu_sources" ADD CONSTRAINT "yodu_sources_organization_id_product_id_products_organization_id_id_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yodu_sources" ADD CONSTRAINT "yodu_sources_organization_id_created_by_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","created_by") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "internal_tasks_organization_id_product_id_status_due_at_index" ON "internal_tasks" USING btree ("organization_id","product_id","status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "native_drafts_source" ON "native_drafts" USING btree ("organization_id","owner_id","source_id");--> statement-breakpoint
CREATE INDEX "yodu_events_product_received" ON "yodu_events" USING btree ("organization_id","product_id","received_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_native_source" ON "conversations" USING btree ("organization_id","owner_id","channel","external_thread_id") WHERE "conversations"."provenance" = 'native';--> statement-breakpoint
CREATE UNIQUE INDEX "messages_native_source" ON "messages" USING btree ("conversation_id","provider_message_id") WHERE "messages"."connection_id" IS NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversation_provenance" CHECK (("conversations"."provenance" = 'provider') = ("conversations"."connection_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "message_body_source" CHECK ("messages"."provider_message_id" <> '');--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "internal_tasks" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "native_drafts" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "yodu_bindings" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "yodu_events" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "yodu_sources" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.internal_tasks, public.native_drafts, public.yodu_sources, public.yodu_bindings, public.yodu_events TO gravity_app;
--> statement-breakpoint
REVOKE ALL ON TABLE public.internal_tasks, public.native_drafts, public.yodu_sources, public.yodu_bindings, public.yodu_events FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE api_role text; BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.internal_tasks, public.native_drafts, public.yodu_sources, public.yodu_bindings, public.yodu_events FROM %I', api_role);
  END LOOP;
END $$;
