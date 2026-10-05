CREATE TABLE "provider_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_credentials" text,
	"webhook_ready" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_configurations_organization_id_owner_id_id_unique" UNIQUE("organization_id","owner_id","id")
);
--> statement-breakpoint
ALTER TABLE "provider_configurations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connections" DROP CONSTRAINT "connections_provider_external_account_id_unique";--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "provider_configuration_id" uuid;--> statement-breakpoint
ALTER TABLE "provider_configurations" ADD CONSTRAINT "provider_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_configurations" ADD CONSTRAINT "provider_configurations_organization_id_owner_id_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","owner_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_configurations_active_owner" ON "provider_configurations" USING btree ("organization_id","owner_id","provider") WHERE "provider_configurations"."active" = true;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_organization_id_owner_id_provider_configuration_id_provider_configurations_organization_id_owner_id_id_fk" FOREIGN KEY ("organization_id","owner_id","provider_configuration_id") REFERENCES "public"."provider_configurations"("organization_id","owner_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connections_legacy_provider_account" ON "connections" USING btree ("provider","external_account_id") WHERE "connections"."provider_configuration_id" IS NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_provider_provider_configuration_id_external_account_id_unique" UNIQUE("provider","provider_configuration_id","external_account_id");--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "provider_configurations" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.provider_configurations TO gravity_app;
--> statement-breakpoint
REVOKE ALL ON TABLE public.provider_configurations FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE api_role text; BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.provider_configurations FROM %I', api_role);
  END LOOP;
END $$;
