CREATE TABLE "file_entry" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "parent_id" text,
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
  "sync_id" bigint DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "file_entry_id_org_unique" UNIQUE("id","organization_id"),
  CONSTRAINT "file_entry_kind" CHECK ("file_entry"."kind" in ('folder', 'markdown', 'file')),
  CONSTRAINT "file_entry_visibility" CHECK ("file_entry"."visibility" in ('private', 'workspace', 'public', 'shared', 'inherit')),
  CONSTRAINT "file_entry_inherit_parent" CHECK ("file_entry"."visibility" <> 'inherit' or "file_entry"."parent_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "file_upload" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "owner_id" text NOT NULL,
  "parent_id" text,
  "name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size" bigint NOT NULL,
  "storage_key" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_entry" ADD CONSTRAINT "file_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_entry" ADD CONSTRAINT "file_entry_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_entry" ADD CONSTRAINT "file_entry_parent_fk" FOREIGN KEY ("parent_id","organization_id") REFERENCES "public"."file_entry"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_entry_parent_idx" ON "file_entry" USING btree ("organization_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_entry_name_unique" ON "file_entry" USING btree ("organization_id",coalesce("parent_id", ''),"owner_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "file_entry_public_token_unique" ON "file_entry" USING btree ("public_token");