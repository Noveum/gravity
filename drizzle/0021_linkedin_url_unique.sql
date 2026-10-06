LOCK TABLE "people" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
WITH "ranked" AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "organization_id", lower("linkedin_url")
      ORDER BY "do_not_contact" DESC, "created_at" ASC, "id" ASC
    ) AS "position"
  FROM "people"
  WHERE "linkedin_url" <> ''
),
"cleared" AS (
  UPDATE "people" AS "person"
  SET "linkedin_url" = '', "version" = "person"."version" + 1
  FROM "ranked"
  WHERE "ranked"."id" = "person"."id" AND "ranked"."position" > 1
  RETURNING "person"."id", "person"."organization_id"
)
INSERT INTO "change_events" ("organization_id", "actor_id", "type", "entity_id")
SELECT "organization_id", 'system', 'person.linkedin_cleared', "id" FROM "cleared";
--> statement-breakpoint
CREATE UNIQUE INDEX "people_organization_linkedin_url" ON "people" USING btree ("organization_id",lower("linkedin_url")) WHERE "people"."linkedin_url" <> '';
