DO $$
DECLARE
  duplicate record;
  replacement text;
BEGIN
  FOR duplicate IN
    SELECT ranked.id, ranked.organization_id, ranked.key
    FROM (
      SELECT
        id,
        organization_id,
        key,
        row_number() OVER (
          PARTITION BY organization_id, key
          ORDER BY (archived_at IS NULL) DESC, created_at, id
        ) AS position_in_key
      FROM pipeline
    ) AS ranked
    WHERE ranked.position_in_key > 1
  LOOP
    SELECT options.candidate INTO replacement
    FROM (
      SELECT left(duplicate.key, 3) || chr(65 + first_letter) AS candidate, first_letter AS rank
      FROM generate_series(0, 25) AS first_letter
      UNION ALL
      SELECT
        left(duplicate.key, 3) || chr(65 + first_letter) || chr(65 + second_letter),
        26 + first_letter * 26 + second_letter
      FROM generate_series(0, 25) AS first_letter, generate_series(0, 25) AS second_letter
    ) AS options
    WHERE NOT EXISTS (
      SELECT 1 FROM pipeline AS taken
      WHERE taken.organization_id = duplicate.organization_id AND taken.key = options.candidate
    )
    ORDER BY options.rank
    LIMIT 1;
    IF replacement IS NULL THEN
      RAISE EXCEPTION 'No free pipeline key to rename archived pipeline %', duplicate.id;
    END IF;
    UPDATE pipeline SET key = replacement WHERE id = duplicate.id;
  END LOOP;
END $$;--> statement-breakpoint
DROP INDEX "pipeline_org_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_org_key_unique" ON "pipeline" USING btree ("organization_id","key");
