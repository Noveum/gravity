CREATE TABLE "asset_upload" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"folder_id" uuid NOT NULL,
	"stage_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text,
	"uploaded_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_upload_size" CHECK ("asset_upload"."size" > 0 AND "asset_upload"."size" <= 104857600)
);
--> statement-breakpoint
ALTER TABLE "asset_upload" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "asset_size_valid";--> statement-breakpoint
ALTER TABLE "asset_upload" ADD CONSTRAINT "asset_upload_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_upload" ADD CONSTRAINT "asset_upload_organization_id_product_id_products_organization_id_id_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_upload" ADD CONSTRAINT "asset_upload_organization_id_uploaded_by_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","uploaded_by") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_upload" ADD CONSTRAINT "asset_upload_organization_id_product_id_folder_id_folders_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","folder_id") REFERENCES "public"."folders"("organization_id","product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "asset_size_valid" CHECK ("assets"."size" > 0 AND "assets"."size" <= 104857600);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "asset_upload" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.asset_upload TO gravity_app;--> statement-breakpoint
REVOKE ALL ON TABLE public.asset_upload FROM PUBLIC;--> statement-breakpoint
DO $$ DECLARE api_role text; BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.asset_upload FROM %I', api_role);
  END LOOP;
END $$;