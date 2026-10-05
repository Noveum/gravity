CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipelines_organization_id_product_id_id_unique" UNIQUE("organization_id","product_id","id"),
	CONSTRAINT "pipelines_organization_id_product_id_name_unique" UNIQUE("organization_id","product_id","name")
);
--> statement-breakpoint
ALTER TABLE "pipelines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "probability" integer;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "expected_close_date" date;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "lost_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "pipeline_id" uuid;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_organization_id_product_id_products_organization_id_id_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_owner_id_memberships_organization_id_user_id_fk" FOREIGN KEY ("organization_id","owner_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_organization_id_product_id_pipeline_id_pipelines_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","pipeline_id") REFERENCES "public"."pipelines"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_activity_idx" ON "messages" USING btree ("organization_id","product_id","occurred_at","id");--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "deal_amount_nonnegative" CHECK ("opportunities"."amount_minor" IS NULL OR "opportunities"."amount_minor" >= 0);--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "deal_probability_valid" CHECK ("opportunities"."probability" IS NULL OR ("opportunities"."probability" >= 0 AND "opportunities"."probability" <= 100));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "deal_status_valid" CHECK ("opportunities"."status" IN ('open', 'won', 'lost'));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "deal_currency_valid" CHECK ("opportunities"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "pipelines" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);
--> statement-breakpoint
INSERT INTO public.pipelines (organization_id, product_id, name) SELECT organization_id, id, 'Sales pipeline' FROM public.products;
--> statement-breakpoint
UPDATE public.stages SET pipeline_id = p.id FROM public.pipelines p WHERE stages.organization_id = p.organization_id AND stages.product_id = p.product_id AND stages.pipeline = 'deal';
--> statement-breakpoint
UPDATE public.opportunities SET owner_id = r.owner_id FROM public.relationships r WHERE opportunities.relationship_id = r.id AND opportunities.organization_id = r.organization_id;
--> statement-breakpoint
UPDATE public.opportunities SET status = CASE WHEN s.category IN ('won', 'lost') THEN s.category ELSE 'open' END FROM public.stages s WHERE opportunities.stage_id = s.id AND opportunities.organization_id = s.organization_id;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pipelines TO gravity_app;
--> statement-breakpoint
REVOKE ALL ON TABLE public.pipelines FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE api_role text; BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.pipelines FROM %I', api_role);
  END LOOP;
END $$;
