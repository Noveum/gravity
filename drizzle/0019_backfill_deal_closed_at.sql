UPDATE "opportunities" AS "deal"
SET "closed_at" = COALESCE(
  (
    SELECT max("event"."created_at")
    FROM "change_events" AS "event"
    WHERE "event"."organization_id" = "deal"."organization_id"
      AND "event"."entity_id" = "deal"."id"
      AND "event"."type" = 'opportunity.' || "deal"."status"
  ),
  "deal"."updated_at"
)
WHERE "deal"."status" IN ('won', 'lost')
  AND "deal"."closed_at" IS NULL;
