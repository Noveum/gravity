CREATE TABLE "file_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"parent_id" uuid,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"grants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"public_token" text NOT NULL,
	"body" text,
	"storage_key" text,
	"mime_type" text,
	"size" bigint DEFAULT 0 NOT NULL,
	"sync_id" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_entry_scope_id" UNIQUE("organization_id","product_id","id"),
	CONSTRAINT "file_entry_kind" CHECK ("file_entry"."kind" in ('folder','markdown','file')),
	CONSTRAINT "file_entry_visibility" CHECK ("file_entry"."visibility" in ('private','workspace','public','shared','inherit')),
	CONSTRAINT "file_entry_inherit_parent" CHECK ("file_entry"."visibility" <> 'inherit' or "file_entry"."parent_id" is not null),
	CONSTRAINT "file_entry_no_self_parent" CHECK ("file_entry"."parent_id" is distinct from "file_entry"."id"),
	CONSTRAINT "file_entry_size" CHECK ("file_entry"."size" between 0 and 104857600)
);
--> statement-breakpoint
ALTER TABLE "file_entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "file_upload" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_upload_size" CHECK ("file_upload"."size" between 0 and 104857600)
);
--> statement-breakpoint
ALTER TABLE "file_upload" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "file_entry" ADD CONSTRAINT "file_entry_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_entry" ADD CONSTRAINT "file_entry_organization_id_product_id_products_organization_id_id_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_entry" ADD CONSTRAINT "file_entry_organization_id_owner_id_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","owner_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_entry" ADD CONSTRAINT "file_entry_organization_id_product_id_parent_id_file_entry_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","parent_id") REFERENCES "public"."file_entry"("organization_id","product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_organization_id_product_id_products_organization_id_id_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_organization_id_owner_id_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","owner_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_organization_id_product_id_parent_id_file_entry_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","parent_id") REFERENCES "public"."file_entry"("organization_id","product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_entry_parent_idx" ON "file_entry" USING btree ("organization_id","product_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_entry_name_unique" ON "file_entry" USING btree ("organization_id","product_id",coalesce("parent_id"::text, ''),"owner_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "file_entry_public_token_unique" ON "file_entry" USING btree ("public_token");--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "file_entry" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "file_upload" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.file_entry, public.file_upload TO gravity_app;

--> statement-breakpoint
REVOKE ALL ON TABLE public.file_entry, public.file_upload FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE api_role text; BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.file_entry, public.file_upload FROM %I', api_role);
  END LOOP;
END $$;
