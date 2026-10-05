CREATE TABLE "integration_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_verifier" text NOT NULL,
	"connection_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "integration_flows_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
ALTER TABLE "integration_flows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integration_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"record" jsonb NOT NULL,
	"status" text DEFAULT 'unmatched' NOT NULL,
	"relationship_id" uuid,
	"entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_items_connection_id_external_id_unique" UNIQUE("connection_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "integration_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integration_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"provider" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_receipts_connection_id_external_id_unique" UNIQUE("connection_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "integration_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "display_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "encrypted_credentials" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "sync_cursor" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "lease_id" uuid;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "webhook_secret" text;--> statement-breakpoint
ALTER TABLE "integration_flows" ADD CONSTRAINT "integration_flows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_flows" ADD CONSTRAINT "integration_flows_organization_id_product_id_products_organization_id_id_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_flows" ADD CONSTRAINT "integration_flows_organization_id_owner_id_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","owner_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_flows" ADD CONSTRAINT "integration_flows_organization_id_connection_id_connections_organization_id_id_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_items" ADD CONSTRAINT "integration_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_items" ADD CONSTRAINT "integration_items_organization_id_connection_id_connections_organization_id_id_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_items" ADD CONSTRAINT "integration_items_organization_id_product_id_products_organization_id_id_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_items" ADD CONSTRAINT "integration_items_organization_id_product_id_relationship_id_relationships_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","relationship_id") REFERENCES "public"."relationships"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_receipts" ADD CONSTRAINT "integration_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_receipts" ADD CONSTRAINT "integration_receipts_organization_id_connection_id_connections_organization_id_id_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_items_organization_id_connection_id_status_index" ON "integration_items" USING btree ("organization_id","connection_id","status");--> statement-breakpoint
CREATE INDEX "integration_receipts_processed_at_next_attempt_at_index" ON "integration_receipts" USING btree ("processed_at","next_attempt_at");--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_organization_id_product_id_products_organization_id_id_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "integration_flows" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "integration_items" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "integration_receipts" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.integration_flows, public.integration_items, public.integration_receipts TO gravity_app;
--> statement-breakpoint
REVOKE ALL ON TABLE public.integration_flows, public.integration_items, public.integration_receipts FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE api_role text; BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.integration_flows, public.integration_items, public.integration_receipts FROM %I', api_role);
  END LOOP;
END $$;
