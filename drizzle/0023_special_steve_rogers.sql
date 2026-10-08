CREATE TABLE "contact_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"product_id" uuid,
	"actor_id" text,
	"source_member_id" text,
	"kind" text NOT NULL,
	"transport" text NOT NULL,
	"client_id" text,
	"grant_id" uuid,
	"batch_id" uuid,
	"source_record_id" text,
	"request_hash" text,
	"connection_id" uuid,
	"source_conversation_id" uuid,
	"provider" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_contribution_batch_row" CHECK (("contact_contributions"."batch_id" IS NULL) = ("contact_contributions"."request_hash" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "contact_contributions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contact_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"submitted_by" text NOT NULL,
	"source_member_id" text,
	"source_kind" text NOT NULL,
	"label" text NOT NULL,
	"submission_key" text NOT NULL,
	"transport" text NOT NULL,
	"client_id" text,
	"grant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_import_batches_organization_id_product_id_id_unique" UNIQUE("organization_id","product_id","id"),
	CONSTRAINT "contact_import_batches_organization_id_submitted_by_submission_key_unique" UNIQUE("organization_id","submitted_by","submission_key")
);
--> statement-breakpoint
ALTER TABLE "contact_import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contact_contributions" ADD CONSTRAINT "contact_contributions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_contributions" ADD CONSTRAINT "contact_contributions_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_contributions" ADD CONSTRAINT "contact_contributions_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_contributions" ADD CONSTRAINT "contact_contributions_organization_id_person_id_people_organization_id_id_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "public"."people"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_contributions" ADD CONSTRAINT "contact_contributions_organization_id_product_id_products_organization_id_id_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_contributions" ADD CONSTRAINT "contact_contributions_organization_id_actor_id_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","actor_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_contributions" ADD CONSTRAINT "contact_contributions_organization_id_source_member_id_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","source_member_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_contributions" ADD CONSTRAINT "contact_contributions_organization_id_product_id_batch_id_contact_import_batches_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","batch_id") REFERENCES "public"."contact_import_batches"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_import_batches" ADD CONSTRAINT "contact_import_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_import_batches" ADD CONSTRAINT "contact_import_batches_organization_id_product_id_products_organization_id_id_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_import_batches" ADD CONSTRAINT "contact_import_batches_organization_id_submitted_by_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","submitted_by") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_import_batches" ADD CONSTRAINT "contact_import_batches_organization_id_source_member_id_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","source_member_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_contributions_person" ON "contact_contributions" USING btree ("organization_id","person_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_contributions_actor" ON "contact_contributions" USING btree ("organization_id","actor_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_contributions_batch_row" ON "contact_contributions" USING btree ("batch_id","source_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_contributions_provider_row" ON "contact_contributions" USING btree ("connection_id","source_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_contributions_original_creator" ON "contact_contributions" USING btree ("person_id") WHERE "contact_contributions"."kind" = 'created';--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "contact_contributions" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "contact_import_batches" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contact_import_batches, public.contact_contributions TO gravity_app;
--> statement-breakpoint
REVOKE ALL ON TABLE public.contact_import_batches, public.contact_contributions FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE api_role text; BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.contact_import_batches, public.contact_contributions FROM %I', api_role);
  END LOOP;
END $$;
