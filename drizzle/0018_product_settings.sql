ALTER TABLE "products" ADD COLUMN "color_key" text DEFAULT 'violet' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "product_color_key" CHECK ("products"."color_key" IN ('violet', 'blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'gray'));--> statement-breakpoint
WITH palette(key, rank, hex) AS (
  VALUES ('violet', 0, '#7565cf'), ('blue', 1, '#4a7fd6'), ('teal', 2, '#418ca0'), ('green', 3, '#4f9a5e'), ('yellow', 4, '#b8962e'), ('orange', 5, '#d0803f'), ('red', 6, '#cf5a5a'), ('pink', 7, '#cf6f93'), ('gray', 8, '#7d8290')
), stored AS (
  SELECT id, lower(btrim(color)) AS value FROM public.products
), expanded AS (
  SELECT id, CASE
    WHEN value ~ '^#[0-9a-f]{6}$' THEN value
    WHEN value ~ '^#[0-9a-f]{3}$' THEN '#' || repeat(substr(value, 2, 1), 2) || repeat(substr(value, 3, 1), 2) || repeat(substr(value, 4, 1), 2)
  END AS hex FROM stored
), channels AS (
  SELECT id, ('x' || substr(hex, 2, 2))::bit(8)::integer AS r, ('x' || substr(hex, 4, 2))::bit(8)::integer AS g, ('x' || substr(hex, 6, 2))::bit(8)::integer AS b FROM expanded WHERE hex IS NOT NULL
), references_rgb AS (
  SELECT key, rank, ('x' || substr(hex, 2, 2))::bit(8)::integer AS r, ('x' || substr(hex, 4, 2))::bit(8)::integer AS g, ('x' || substr(hex, 6, 2))::bit(8)::integer AS b FROM palette
), neutral AS (
  SELECT key FROM references_rgb ORDER BY greatest(r, g, b) - least(r, g, b), rank LIMIT 1
), nearest AS (
  SELECT channels.id, neutral.key
  FROM channels CROSS JOIN neutral
  WHERE greatest(channels.r, channels.g, channels.b) - least(channels.r, channels.g, channels.b) < 24
  UNION ALL
  SELECT * FROM (
  SELECT DISTINCT ON (channels.id) channels.id, references_rgb.key
  FROM channels CROSS JOIN references_rgb
  WHERE greatest(channels.r, channels.g, channels.b) - least(channels.r, channels.g, channels.b) >= 24
  ORDER BY channels.id, (channels.r - references_rgb.r) * (channels.r - references_rgb.r) + (channels.g - references_rgb.g) * (channels.g - references_rgb.g) + (channels.b - references_rgb.b) * (channels.b - references_rgb.b), references_rgb.rank
  ) AS chromatic
)
UPDATE public.products SET color_key = nearest.key FROM nearest WHERE products.id = nearest.id;
