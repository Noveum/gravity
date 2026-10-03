CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_id" text,
	"sync_id" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_link" (
	"activity_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "activity_link_activity_id_entity_type_entity_id_pk" PRIMARY KEY("activity_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "brand" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"color" text DEFAULT 'blue' NOT NULL,
	"signature" text DEFAULT '' NOT NULL,
	"current_playbook_version" integer DEFAULT 1 NOT NULL,
	"sync_id" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "field_definition" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"object" text NOT NULL,
	"pipeline_id" text,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"example" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"sync_id" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "field_definition_object" CHECK ("field_definition"."object" in ('person', 'company', 'lead', 'deal'))
);
--> statement-breakpoint
CREATE TABLE "pipeline" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"kind" text DEFAULT 'people' NOT NULL,
	"lead_counter" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"sync_id" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "pipeline_key_format" CHECK ("pipeline"."key" ~ '^[A-Z]{2,5}$'),
	CONSTRAINT "pipeline_kind" CHECK ("pipeline"."kind" in ('people', 'deals'))
);
--> statement-breakpoint
CREATE TABLE "playbook_version" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"version" integer NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"pipeline_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"sort_order" integer NOT NULL,
	"sync_id" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "stage_category" CHECK ("stage"."category" in ('open', 'won', 'lost', 'hold'))
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"person_id" text NOT NULL,
	"pipeline_id" text NOT NULL,
	"number" integer NOT NULL,
	"owner_id" text,
	"stage_id" text NOT NULL,
	"stage_category" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"hold_reason" text,
	"hold_until" timestamp with time zone,
	"next_action" text,
	"next_action_at" timestamp with time zone,
	"owed_by" text DEFAULT 'none' NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"unanswered_streak" integer DEFAULT 0 NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fields_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deal_id" text,
	"sync_id" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "lead_stage_category" CHECK ("lead"."stage_category" in ('open', 'won', 'lost', 'hold')),
	CONSTRAINT "lead_priority_range" CHECK ("lead"."priority" between 0 and 4),
	CONSTRAINT "lead_owed_by" CHECK ("lead"."owed_by" in ('us', 'them', 'none'))
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"primary_domain" text,
	"size" text,
	"revenue" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"segment" text,
	"location" text,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fields_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sync_id" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "employment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"person_id" text NOT NULL,
	"company_id" text NOT NULL,
	"title" text,
	"started_at" date,
	"ended_at" date,
	"is_current" boolean DEFAULT true NOT NULL,
	"sync_id" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"primary_email" text,
	"phones" text[] DEFAULT '{}'::text[] NOT NULL,
	"linkedin_url" text,
	"linkedin_provider_id" text,
	"location" text,
	"timezone" text,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fields_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sync_id" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "saved_view" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"object" text NOT NULL,
	"pipeline_id" text,
	"name" text NOT NULL,
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"display" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"owner_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"sync_id" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "view_preference" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"page" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"layout" text DEFAULT 'list' NOT NULL,
	"display" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_link" ADD CONSTRAINT "activity_link_activity_id_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_link" ADD CONSTRAINT "activity_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand" ADD CONSTRAINT "brand_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_definition" ADD CONSTRAINT "field_definition_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_definition" ADD CONSTRAINT "field_definition_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_version" ADD CONSTRAINT "playbook_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_version" ADD CONSTRAINT "playbook_version_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_version" ADD CONSTRAINT "playbook_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage" ADD CONSTRAINT "stage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage" ADD CONSTRAINT "stage_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_stage_id_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stage"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment" ADD CONSTRAINT "employment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment" ADD CONSTRAINT "employment_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment" ADD CONSTRAINT "employment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_preference" ADD CONSTRAINT "view_preference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_preference" ADD CONSTRAINT "view_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_org_external_unique" ON "activity" USING btree ("organization_id","external_id") WHERE "activity"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "activity_org_occurred_idx" ON "activity" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_link_entity_idx" ON "activity_link" USING btree ("organization_id","entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "brand_org_idx" ON "brand" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_org_name_unique" ON "brand" USING btree ("organization_id",lower("name")) WHERE "brand"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "field_definition_org_idx" ON "field_definition" USING btree ("organization_id","object");--> statement-breakpoint
CREATE UNIQUE INDEX "field_definition_key_unique" ON "field_definition" USING btree ("organization_id","object",coalesce("pipeline_id", ''),"key") WHERE "field_definition"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "pipeline_brand_idx" ON "pipeline" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_org_key_unique" ON "pipeline" USING btree ("organization_id","key") WHERE "pipeline"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "playbook_version_brand_version_unique" ON "playbook_version" USING btree ("brand_id","version");--> statement-breakpoint
CREATE INDEX "stage_pipeline_order_idx" ON "stage" USING btree ("pipeline_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_pipeline_number_unique" ON "lead" USING btree ("pipeline_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_open_person_pipeline_unique" ON "lead" USING btree ("person_id","pipeline_id") WHERE "lead"."stage_category" in ('open', 'hold') and "lead"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "lead_org_pipeline_stage_idx" ON "lead" USING btree ("organization_id","pipeline_id","stage_id");--> statement-breakpoint
CREATE INDEX "lead_person_idx" ON "lead" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "lead_owner_idx" ON "lead" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_org_primary_domain_unique" ON "company" USING btree ("organization_id","primary_domain") WHERE "company"."primary_domain" is not null and "company"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "company_domains_gin" ON "company" USING gin ("domains");--> statement-breakpoint
CREATE INDEX "company_name_trgm" ON "company" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "company_primary_domain_trgm" ON "company" USING gin ("primary_domain" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "company_org_name_idx" ON "company" USING btree ("organization_id",lower("name"),"id");--> statement-breakpoint
CREATE INDEX "employment_person_idx" ON "employment" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "employment_company_idx" ON "employment" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employment_current_unique" ON "employment" USING btree ("person_id","company_id") WHERE "employment"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "person_org_primary_email_unique" ON "person" USING btree ("organization_id","primary_email") WHERE "person"."primary_email" is not null and "person"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "person_org_linkedin_provider_unique" ON "person" USING btree ("organization_id","linkedin_provider_id") WHERE "person"."linkedin_provider_id" is not null and "person"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "person_org_linkedin_url_idx" ON "person" USING btree ("organization_id","linkedin_url");--> statement-breakpoint
CREATE INDEX "person_emails_gin" ON "person" USING gin ("emails");--> statement-breakpoint
CREATE INDEX "person_name_trgm" ON "person" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "person_primary_email_trgm" ON "person" USING gin ("primary_email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "person_org_name_idx" ON "person" USING btree ("organization_id",lower("name"),"id");--> statement-breakpoint
CREATE INDEX "saved_view_org_idx" ON "saved_view" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "saved_view_owner_idx" ON "saved_view" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "view_preference_unique" ON "view_preference" USING btree ("user_id","organization_id","page","scope");