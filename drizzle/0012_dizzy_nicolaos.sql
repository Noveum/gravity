CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"relationship_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"touch_id" uuid,
	"action_id" uuid,
	"source_version" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"channel" text NOT NULL,
	"recipient" text NOT NULL,
	"draft" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"external_thread_id" text,
	"external_message_id" text,
	"status" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "deliveries_organization_id_owner_id_idempotency_key_unique" UNIQUE("organization_id","owner_id","idempotency_key"),
	CONSTRAINT "delivery_source" CHECK (("deliveries"."touch_id" IS NOT NULL) <> ("deliveries"."action_id" IS NOT NULL)),
	CONSTRAINT "delivery_status" CHECK ("deliveries"."status" IN ('sending', 'unknown', 'accepted', 'sent', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_product_id_relationship_id_relationships_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","relationship_id") REFERENCES "public"."relationships"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_product_id_touch_id_touches_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","touch_id") REFERENCES "public"."touches"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_product_id_action_id_actions_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","action_id") REFERENCES "public"."actions"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_connection_id_connections_organization_id_id_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_owner_id_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","owner_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_touch_claim" ON "deliveries" USING btree ("touch_id") WHERE "deliveries"."status" <> 'failed';--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_action_claim" ON "deliveries" USING btree ("action_id") WHERE "deliveries"."status" <> 'failed';--> statement-breakpoint
CREATE INDEX "deliveries_sender_day" ON "deliveries" USING btree ("organization_id","owner_id","created_at");--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "deliveries" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.deliveries TO gravity_app;
--> statement-breakpoint
REVOKE ALL ON TABLE public.deliveries FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE api_role text; BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.deliveries FROM %I', api_role);
  END LOOP;
END $$;
