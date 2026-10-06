UPDATE "invitations" SET "email" = lower("email") WHERE "email" <> lower("email");--> statement-breakpoint
UPDATE "invitations" SET "revoked_at" = NULL WHERE "accepted_at" IS NOT NULL AND "revoked_at" IS NOT NULL;--> statement-breakpoint
WITH "ranked" AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "organization_id", "email"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS "position"
  FROM "invitations"
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL
)
UPDATE "invitations" SET "revoked_at" = now()
FROM "ranked"
WHERE "ranked"."id" = "invitations"."id" AND "ranked"."position" > 1;--> statement-breakpoint
UPDATE "mcp_grants" SET "active" = false
FROM "memberships"
WHERE "memberships"."organization_id" = "mcp_grants"."organization_id"
  AND "memberships"."user_id" = "mcp_grants"."user_id"
  AND "memberships"."active" = false
  AND "mcp_grants"."active" = true;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "allowed_email_domains" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_email" ON "invitations" USING btree ("organization_id","email") WHERE "invitations"."accepted_at" IS NULL AND "invitations"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_email_lowercase" CHECK ("invitations"."email" = lower("invitations"."email"));--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_single_outcome" CHECK ("invitations"."accepted_at" IS NULL OR "invitations"."revoked_at" IS NULL);--> statement-breakpoint
REVOKE ALL ON TABLE public.invitations FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE api_role text; BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.invitations FROM %I', api_role);
  END LOOP;
END $$;
